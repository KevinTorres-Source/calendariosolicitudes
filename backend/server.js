const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

function cargarEnvLocal() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lineas = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  lineas.forEach(linea => {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) return;

    const separador = limpia.indexOf("=");
    if (separador === -1) return;

    const key = limpia.slice(0, separador).trim();
    let value = limpia.slice(separador + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

cargarEnvLocal();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DISPOSITIVOS_POR_DIA = parseInt(process.env.MAX_DISPOSITIVOS_POR_DIA || "70", 10);
const DEFAULT_SOLICITUDES_POR_HORA = parseInt(process.env.DEFAULT_SOLICITUDES_POR_HORA || "2", 10);
const RESERVAS_FILE = path.join(__dirname, "reservas.json");
const BLOQUEOS_FILE = path.join(__dirname, "bloqueos.json");
const FEEDBACK_FILE = path.join(__dirname, "feedback.json");
const LIMITES_SOLICITUDES_FILE = path.join(__dirname, "limites-solicitudes.json");
const LIMITES_DISPOSITIVOS_FILE = path.join(__dirname, "limites-dispositivos.json");
const ADMIN_CONFIG_FILE = path.join(__dirname, "admin-config.json");
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "8h";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const DIAS_ANTELACION_RESERVA = 2;
const loginAttempts = new Map();
const FESTIVOS_COLOMBIA = new Set([
  "2026-06-29",
  "2026-07-13",
  "2026-07-20",
  "2026-08-07",
  "2026-08-17",
  "2026-10-12",
  "2026-11-02",
  "2026-11-16",
  "2026-12-08",
  "2026-12-25"
]);
const SECCIONES_PERMITIDAS = new Set([
  "Sección Preescolar y 1º",
  "Sección Primaria y 6º",
  "Sección Secundaria y Media"
]);

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET no configurado; los tokens se invalidaran al reiniciar el servidor.");
}

const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "../frontend")));

function normalizarReserva(reserva) {
  if (!reserva || typeof reserva !== "object") return reserva;

  const asignatura = obtenerAsignaturaSolicitud(reserva);
  const objetivo = obtenerObjetivoSolicitud(reserva);

  if (asignatura) {
    reserva.asignatura = asignatura;
    reserva.materia = asignatura;
    reserva.subject = asignatura;
  }

  if (objetivo) {
    reserva.objetivoUso = objetivo;
    reserva.nota = objetivo;
  }

  return reserva;
}

function normalizarReservas(lista) {
  return Array.isArray(lista) ? lista.map(normalizarReserva) : [];
}

// =======================
// CARGAR DATOS
// =======================
let reservas = [];
let bloqueos = [];
let feedback = [];
let limitesSolicitudes = [];
let limitesDispositivos = [];
let adminConfig = {
  username: "admin",
  passwordHash: "",
  coordinators: []
};

try {
  const data = fs.readFileSync(RESERVAS_FILE, "utf-8");
  reservas = normalizarReservas(JSON.parse(data));
} catch {
  reservas = [];
}

try {
  const data = fs.readFileSync(BLOQUEOS_FILE, "utf-8");
  bloqueos = JSON.parse(data);
} catch {
  bloqueos = [];
}

try {
  const data = fs.readFileSync(FEEDBACK_FILE, "utf-8");
  feedback = JSON.parse(data);
} catch {
  feedback = [];
}

try {
  const data = fs.readFileSync(LIMITES_SOLICITUDES_FILE, "utf-8");
  limitesSolicitudes = JSON.parse(data);
} catch {
  limitesSolicitudes = [];
}

try {
  const data = fs.readFileSync(LIMITES_DISPOSITIVOS_FILE, "utf-8");
  limitesDispositivos = JSON.parse(data);
} catch {
  limitesDispositivos = [];
}

try {
  const data = fs.readFileSync(ADMIN_CONFIG_FILE, "utf-8");
  adminConfig = { ...adminConfig, ...JSON.parse(data) };
} catch {
  fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(adminConfig, null, 2));
}

function guardarReservas() {
  reservas = normalizarReservas(reservas);
  fs.writeFileSync(RESERVAS_FILE, JSON.stringify(reservas, null, 2));
}

function guardarBloqueos() {
  fs.writeFileSync(BLOQUEOS_FILE, JSON.stringify(bloqueos, null, 2));
}

function guardarFeedback() {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
}

function guardarLimitesSolicitudes() {
  fs.writeFileSync(LIMITES_SOLICITUDES_FILE, JSON.stringify(limitesSolicitudes, null, 2));
}

function guardarLimitesDispositivos() {
  fs.writeFileSync(LIMITES_DISPOSITIVOS_FILE, JSON.stringify(limitesDispositivos, null, 2));
}

function validarAdmin(username, password) {
  const usuarioValido =
    String(username || "").trim().toLowerCase() === String(adminConfig.username || "").trim().toLowerCase();
  const passwordValido = bcrypt.compareSync(String(password || "").trim(), adminConfig.passwordHash || "");
  return usuarioValido && passwordValido;
}

function validarCoordinador(username, password) {
  const usuario = String(username || "").trim().toLowerCase();
  const coordinador = (adminConfig.coordinators || []).find(item =>
    String(item.username || "").trim().toLowerCase() === usuario
  );

  return Boolean(coordinador && bcrypt.compareSync(String(password || "").trim(), coordinador.passwordHash || ""));
}

function correoInstitucionalValido(correo) {
  return /^[^\s@]+@colamericano\.edu\.co$/i.test(String(correo || "").trim());
}

function obtenerTokenAutorizacion(req) {
  const authHeader = String(req.headers["authorization"] || "").trim();
  if (!authHeader) return "";
  return authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader;
}

function crearTokenSesion({ rol, usuario }) {
  return jwt.sign({ rol, usuario }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES_IN,
    issuer: "calendario-solicitudes"
  });
}

function verificarTokenSesion(req) {
  const token = obtenerTokenAutorizacion(req);
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET, { issuer: "calendario-solicitudes" });
  } catch {
    return null;
  }
}

function obtenerRolDesdeToken(req) {
  const sesion = verificarTokenSesion(req);
  if (sesion?.rol === "admin") return "admin";
  if (sesion?.rol === "coordinador") return "coordinador";
  return "profesor";
}

function requerirAdmin(req, res, next) {
  const sesion = verificarTokenSesion(req);
  if (sesion?.rol !== "admin") {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

function obtenerClaveLogin(req, username) {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${String(username || "").trim().toLowerCase()}`;
}

function loginBloqueado(req, username) {
  const clave = obtenerClaveLogin(req, username);
  const ahora = Date.now();
  const intento = loginAttempts.get(clave);

  if (!intento || ahora - intento.inicio > LOGIN_WINDOW_MS) {
    loginAttempts.set(clave, { conteo: 0, inicio: ahora });
    return false;
  }

  return intento.conteo >= LOGIN_MAX_ATTEMPTS;
}

function registrarLoginFallido(req, username) {
  const clave = obtenerClaveLogin(req, username);
  const ahora = Date.now();
  const intento = loginAttempts.get(clave);

  if (!intento || ahora - intento.inicio > LOGIN_WINDOW_MS) {
    loginAttempts.set(clave, { conteo: 1, inicio: ahora });
    return;
  }

  intento.conteo += 1;
}

function limpiarIntentosLogin(req, username) {
  loginAttempts.delete(obtenerClaveLogin(req, username));
}

function fechaISO(fecha) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function esFestivoColombia(fecha) {
  return FESTIVOS_COLOMBIA.has(String(fecha || ""));
}

function obtenerInicioSemana(fecha) {
  const dia = fecha.getDay();
  const lunes = new Date(fecha);
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(fecha.getDate() - (dia === 0 ? 6 : dia - 1));
  return lunes;
}

function estaEnVentanaReservaProfesor(fecha) {
  const hoy = new Date();
  const inicioSemana = obtenerInicioSemana(hoy);
  const inicio = new Date(hoy);
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() + DIAS_ANTELACION_RESERVA);

  const fin = new Date(inicioSemana);
  fin.setDate(inicioSemana.getDate() + 13);
  fin.setHours(23, 59, 59, 999);

  const [year, month, day] = String(fecha || "").split("-").map(Number);
  const objetivo = new Date(year, month - 1, day);
  objetivo.setHours(12, 0, 0, 0);

  return fechaISO(objetivo) === fecha && objetivo >= inicio && objetivo <= fin;
}

function escaparHTML(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatearFechaCorreo(fecha) {
  const [year, month, day] = String(fecha || "").split("-").map(Number);
  if (!year || !month || !day) return fecha || "Sin fecha";

  return new Date(year, month - 1, day).toLocaleDateString("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

async function enviarCorreoReserva(reserva) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { enviado: false, razon: "SMTP no configurado" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return { enviado: false, razon: "nodemailer no instalado" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const fechaTexto = formatearFechaCorreo(reserva.fecha);
  const esRechazada = reserva.estado === "rechazado";
  const estadoTexto = esRechazada ? "Rechazada" : "Aprobada";
  const tituloCorreo = esRechazada ? "Solicitud de iPads rechazada" : "Solicitud de iPads confirmada";
  const mensajePrincipal = esRechazada
    ? "Su solicitud de prestamo de iPads fue rechazada."
    : "Su solicitud de prestamo de iPads quedo registrada y aprobada.";
  const saludoEstado = esRechazada
    ? "tu solicitud fue rechazada."
    : "tu solicitud quedo registrada y aprobada.";
  const colorEstado = esRechazada ? "#b42318" : "#16803c";
  const texto = [
    mensajePrincipal,
    "",
    `Nombre: ${reserva.usuario}`,
    `Fecha: ${fechaTexto}`,
    `Hora: ${reserva.hour}`,
    `Curso / Grado: ${reserva.curso}`,
    `Seccion: ${reserva.seccion || "N/A"}`,
    `Asignatura: ${reserva.asignatura || "N/A"}`,
    `Cantidad de iPads: ${reserva.cantidad}`,
    `Objetivo de uso: ${reserva.objetivoUso || reserva.nota || "N/A"}`,
    `Estado: ${estadoTexto}`,
    "",
    "Gracias por usar el calendario de solicitudes del Colegio Americano de Bogotá Bilingüe."
  ].join("\n");

  const html = `
    <div style="margin:0;padding:24px;background:#f3f6fa;font-family:Arial,sans-serif;color:#1f2937;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#1C4169;padding:22px 26px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;line-height:1.25;">${tituloCorreo}</h1>
            <p style="margin:6px 0 0;color:#F08C28;font-weight:700;">Colegio Americano de Bogotá Bilingüe</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 26px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
              Hola ${escaparHTML(reserva.usuario)}, ${saludoEstado}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Nombre</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.usuario)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Fecha</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(fechaTexto)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Hora</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.hour)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Curso / Grado</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.curso || "N/A")}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Seccion</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.seccion || "N/A")}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Asignatura</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.asignatura || "N/A")}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Cantidad de iPads</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${escaparHTML(reserva.cantidad)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#667085;font-weight:700;">Estado</td>
                <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;font-weight:800;color:${colorEstado};">${escaparHTML(estadoTexto)}</td>
              </tr>
            </table>
            <div style="margin-top:18px;padding:14px 16px;background:#f8fafc;border-left:4px solid #F08C28;border-radius:8px;">
              <strong style="display:block;margin-bottom:6px;color:#1C4169;">Objetivo de uso</strong>
              <p style="margin:0;line-height:1.5;">${escaparHTML(reserva.objetivoUso || reserva.nota || "Sin objetivo de uso")}</p>
            </div>
            <p style="margin:20px 0 0;color:#667085;font-size:12px;line-height:1.5;">
              Este mensaje fue generado automaticamente por el calendario de solicitudes por favor no responder.
            </p>
          </td>
        </tr>
      </table>
    </div>`;

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Calendario Solicitudes CABB" <${process.env.SMTP_USER}>`,
    to: reserva.correo,
    subject: `${tituloCorreo} - correo automatico por favor no responder`,
    text: texto,
    html
  });

  return { enviado: true, messageId: info.messageId };
}

function contarDispositivosReservados(fecha, hour, excluirId = null) {
  return reservas
    .filter(r =>
      r.fecha === fecha &&
      r.hour === hour &&
      r.id !== excluirId &&
      r.estado !== "rechazado"
    )
    .reduce((total, r) => total + (parseInt(r.cantidad, 10) || 0), 0);
}

function obtenerMaxDispositivosPorDia(fecha) {
  const limiteDia = limitesDispositivos.find(item => item.fecha === fecha);
  const limite = parseInt(limiteDia?.limite, 10);
  return Number.isInteger(limite) && limite > 0 ? limite : MAX_DISPOSITIVOS_POR_DIA;
}

function validarCapacidadHorario(fecha, hour, cantidad, excluirId = null) {
  const cantidadSolicitada = parseInt(cantidad, 10);

  if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada <= 0) {
    return { error: "Ingresa una cantidad valida de dispositivos" };
  }

  const usados = contarDispositivosReservados(fecha, hour, excluirId);
  const disponibles = obtenerMaxDispositivosPorDia(fecha) - usados;

  if (cantidadSolicitada > disponibles) {
    return {
      error: "No hay suficientes iPads disponibles para ese horario."
    };
  }

  return { cantidadSolicitada, usados, disponibles };
}

function obtenerLimiteSolicitudesPorHora(fecha) {
  const limiteDia = limitesSolicitudes.find(item => item.fecha === fecha);
  const limite = parseInt(limiteDia?.limite, 10);
  return Number.isInteger(limite) && limite > 0 ? limite : DEFAULT_SOLICITUDES_POR_HORA;
}

function contarSolicitudesPorHorario(fecha, hour) {
  return reservas.filter(r =>
    r.fecha === fecha &&
    r.hour === hour &&
    r.estado !== "rechazado"
  ).length;
}

function validarLimiteSolicitudesHorario(fecha, hour) {
  const limite = obtenerLimiteSolicitudesPorHora(fecha);
  const usadas = contarSolicitudesPorHorario(fecha, hour);

  if (usadas >= limite) {
    return {
      error: `Este horario ya alcanzó el límite de ${limite} solicitudes.`,
      limite,
      usadas
    };
  }

  return { limite, usadas, disponibles: limite - usadas };
}

function obtenerAsignaturaSolicitud(solicitud) {
  return String(solicitud.asignatura || solicitud.materia || solicitud.subject || solicitud.area || "").trim();
}

function obtenerObjetivoSolicitud(solicitud) {
  return String(solicitud.objetivoUso || solicitud.nota || "").trim();
}

function validarSolicitudReserva(solicitud, rol = "profesor") {
  const { fecha, hour, equipo, usuario, cantidad, correo, seccion } = solicitud;
  const asignatura = obtenerAsignaturaSolicitud(solicitud);
  const objetivo = obtenerObjetivoSolicitud(solicitud);

  if (!fecha || !hour || !equipo || !usuario || !correo || !seccion || !asignatura || !objetivo) {
    return { error: "Faltan datos obligatorios" };
  }

  if (!SECCIONES_PERMITIDAS.has(String(seccion || "").trim())) {
    return { error: "La sección seleccionada no es válida" };
  }

  if (!["admin", "coordinador"].includes(rol) && !estaEnVentanaReservaProfesor(fecha)) {
    return { error: "Solo puedes agendar con 2 días de antelación hasta el final de la semana siguiente." };
  }

  if (esFestivoColombia(fecha)) {
    return { error: "No se pueden hacer solicitudes en festivos." };
  }

  if (!correoInstitucionalValido(correo)) {
    return { error: "El correo debe pertenecer al dominio @colamericano.edu.co" };
  }

  const capacidad = validarCapacidadHorario(fecha, hour, cantidad);
  if (capacidad.error) {
    return { error: capacidad.error };
  }

  const limiteHorario = validarLimiteSolicitudesHorario(fecha, hour);
  if (limiteHorario.error) {
    return { error: limiteHorario.error };
  }

  const bloqueado = bloqueos.find(b =>
    b.fecha === fecha &&
    (b.hour === hour || b.hour === null)
  );

  if (bloqueado) {
    return { error: "Este horario está bloqueado por el administrador 🚫" };
  }

  return { capacidad };
}

function textoNormalizado(valor) {
  return String(valor || "").trim().toLowerCase();
}

function completarReservaDuplicada(reserva, solicitud) {
  const asignatura = obtenerAsignaturaSolicitud(solicitud);
  const objetivo = obtenerObjetivoSolicitud(solicitud);
  let actualizada = false;

  if (!reserva.seccion && solicitud.seccion) {
    reserva.seccion = String(solicitud.seccion || "").trim();
    actualizada = true;
  }

  if (!obtenerAsignaturaSolicitud(reserva) && asignatura) {
    reserva.asignatura = asignatura;
    reserva.materia = asignatura;
    reserva.subject = asignatura;
    actualizada = true;
  }

  if (!obtenerObjetivoSolicitud(reserva) && objetivo) {
    reserva.objetivoUso = objetivo;
    reserva.nota = objetivo;
    actualizada = true;
  }

  if (actualizada) guardarReservas();
  return reserva;
}

function buscarReservaDuplicadaReciente(solicitud) {
  const { clientRequestId, fecha, hour, usuario, curso, seccion, cantidad, correo } = solicitud;
  const asignatura = obtenerAsignaturaSolicitud(solicitud);
  const objetivo = obtenerObjetivoSolicitud(solicitud);

  if (clientRequestId) {
    const existentePorRequest = reservas.find(r => r.clientRequestId === clientRequestId);
    if (existentePorRequest) return completarReservaDuplicada(existentePorRequest, solicitud);
  }

  const ahora = Date.now();
  const ventanaDuplicadoMs = 5 * 60 * 1000;
  const cantidadNormalizada = parseInt(cantidad, 10);

  return reservas.find(r => {
    const creadoEn = Date.parse(r.creadoEn || "");
    return r.estado !== "rechazado" &&
      r.fecha === fecha &&
      r.hour === hour &&
      textoNormalizado(r.usuario) === textoNormalizado(usuario) &&
      textoNormalizado(r.curso) === textoNormalizado(curso) &&
      textoNormalizado(r.seccion) === textoNormalizado(seccion) &&
      textoNormalizado(obtenerAsignaturaSolicitud(r)) === textoNormalizado(asignatura) &&
      parseInt(r.cantidad, 10) === cantidadNormalizada &&
      textoNormalizado(r.correo) === textoNormalizado(correo) &&
      textoNormalizado(obtenerObjetivoSolicitud(r)) === textoNormalizado(objetivo) &&
      Number.isFinite(creadoEn) &&
      ahora - creadoEn <= ventanaDuplicadoMs;
  });
}

// =======================
// RUTAS
// =======================
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// GET configuracion publica
app.get("/config", (req, res) => {
  res.json({
    maxDispositivosPorDia: MAX_DISPOSITIVOS_POR_DIA,
    solicitudesPorHoraDefault: DEFAULT_SOLICITUDES_POR_HORA
  });
});

// GET reservas
app.get("/reservas", (req, res) => {
  res.json(normalizarReservas(reservas));
});

// GET solicitudes recientes (solo admin)
app.get("/reservas/recientes", requerirAdmin, (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 100);
  const recientes = [...reservas]
    .sort((a, b) => {
      const fechaA = Date.parse(a.creadoEn || "") || parseInt(a.id, 10) || 0;
      const fechaB = Date.parse(b.creadoEn || "") || parseInt(b.id, 10) || 0;
      return fechaB - fechaA;
    })
    .slice(0, limite);

  res.json(normalizarReservas(recientes));
});

// POST validar reserva sin guardarla
app.post("/reservas/validar", (req, res) => {
  const validacion = validarSolicitudReserva(req.body, obtenerRolDesdeToken(req));

  if (validacion.error) {
    return res.status(400).json({ error: validacion.error });
  }

  res.json({ message: "Solicitud valida" });
});

// POST nueva reserva
app.post("/reservas", async (req, res) => {
  const { clientRequestId, fecha, hour, equipo, usuario, curso, seccion, cantidad, correo } = req.body;
  const asignatura = obtenerAsignaturaSolicitud(req.body);
  const objetivo = obtenerObjetivoSolicitud(req.body);

  const reservaDuplicada = buscarReservaDuplicadaReciente(req.body);
  if (reservaDuplicada) {
    return res.json({
      message: "Reserva creada ✅",
      reserva: reservaDuplicada,
      duplicada: true,
      correo: { enviado: false, razon: "Solicitud duplicada; se reutilizo la reserva existente" }
    });
  }

  const validacion = validarSolicitudReserva(req.body, obtenerRolDesdeToken(req));
  if (validacion.error) {
    return res.status(400).json({ error: validacion.error });
  }

  const nuevaReserva = {
    id: Date.now(), // ID único basado en timestamp
    creadoEn: new Date().toISOString(),
    clientRequestId: clientRequestId || "",
    fecha,
    hour,
    equipo,
    usuario,
    curso: curso || "",
    seccion: String(seccion || "").trim(),
    asignatura,
    materia: asignatura,
    subject: asignatura,
    cantidad: validacion.capacidad.cantidadSolicitada,
    correo: String(correo || "").trim(),
    objetivoUso: objetivo,
    nota: objetivo,
    estado: "aprobado"
  };

  reservas.push(nuevaReserva);
  guardarReservas();
  let correoResultado = { enviado: false, razon: "No se intento enviar" };
  try {
    correoResultado = await enviarCorreoReserva(nuevaReserva);
  } catch (error) {
    console.error("No se pudo enviar el correo de confirmacion:", error.message);
    correoResultado = { enviado: false, razon: error.message };
  }

  res.json({ message: "Reserva creada ✅", reserva: nuevaReserva, correo: correoResultado });
});

// PUT cambiar estado de reserva (solo admin)
app.put("/reservas/:id", requerirAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { estado } = req.body;

  const reserva = reservas.find(r => r.id === id);

  if (!reserva) {
    return res.status(404).json({ error: "Reserva no encontrada" });
  }

  if (!["aprobado", "rechazado"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  if (estado === "aprobado") {
    const capacidad = validarCapacidadHorario(reserva.fecha, reserva.hour, reserva.cantidad, reserva.id);
    if (capacidad.error) {
      return res.status(400).json({ error: capacidad.error });
    }
  }

  const estadoAnterior = reserva.estado;
  reserva.estado = estado;
  guardarReservas();
  let correoResultado = { enviado: false, razon: "No se intento enviar" };

  if (estado === "rechazado" && estadoAnterior !== "rechazado") {
    try {
      correoResultado = await enviarCorreoReserva(reserva);
    } catch (error) {
      console.error("No se pudo enviar el correo de rechazo:", error.message);
      correoResultado = { enviado: false, razon: error.message };
    }
  }

  res.json({ message: "Estado actualizado ✅", reserva, correo: correoResultado });
});

// DELETE eliminar reserva (solo admin)
app.delete("/reservas/:id", requerirAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const index = reservas.findIndex(r => r.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Reserva no encontrada" });
  }

  reservas.splice(index, 1);
  guardarReservas();

  res.json({ message: "Reserva eliminada ✅" });
});

// GET bloqueos
app.get("/bloqueos", (req, res) => {
  res.json(bloqueos);
});

// GET limites diarios de solicitudes por horario
app.get("/limites-solicitudes", (req, res) => {
  res.json(limitesSolicitudes);
});

// GET limites diarios de dispositivos
app.get("/limites-dispositivos", (req, res) => {
  res.json(limitesDispositivos);
});

// PUT limite diario de solicitudes por horario (solo admin)
app.put("/limites-solicitudes/:fecha", requerirAdmin, (req, res) => {
  const fecha = req.params.fecha;
  const limite = parseInt(req.body?.limite, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Fecha invalida" });
  }

  if (!Number.isInteger(limite) || limite <= 0) {
    return res.status(400).json({ error: "El limite debe ser un numero mayor a 0" });
  }

  const existente = limitesSolicitudes.find(item => item.fecha === fecha);
  if (existente) {
    existente.limite = limite;
  } else {
    limitesSolicitudes.push({ fecha, limite });
  }

  guardarLimitesSolicitudes();
  res.json({ message: "Limite actualizado", limite: { fecha, limite } });
});

// DELETE restablecer limite diario (solo admin)
app.delete("/limites-solicitudes/:fecha", requerirAdmin, (req, res) => {
  const fecha = req.params.fecha;
  limitesSolicitudes = limitesSolicitudes.filter(item => item.fecha !== fecha);
  guardarLimitesSolicitudes();
  res.json({ message: "Limite restablecido", fecha });
});

// PUT limite diario de dispositivos (solo admin)
app.put("/limites-dispositivos/:fecha", requerirAdmin, (req, res) => {
  const fecha = req.params.fecha;
  const limite = parseInt(req.body?.limite, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: "Fecha invalida" });
  }

  if (!Number.isInteger(limite) || limite <= 0) {
    return res.status(400).json({ error: "El limite debe ser un numero mayor a 0" });
  }

  const existente = limitesDispositivos.find(item => item.fecha === fecha);
  if (existente) {
    existente.limite = limite;
  } else {
    limitesDispositivos.push({ fecha, limite });
  }

  guardarLimitesDispositivos();
  res.json({ message: "Limite actualizado", limite: { fecha, limite } });
});

// DELETE restablecer limite diario de dispositivos (solo admin)
app.delete("/limites-dispositivos/:fecha", requerirAdmin, (req, res) => {
  const fecha = req.params.fecha;
  limitesDispositivos = limitesDispositivos.filter(item => item.fecha !== fecha);
  guardarLimitesDispositivos();
  res.json({ message: "Limite restablecido", fecha });
});

// GET feedback
app.get("/feedback", requerirAdmin, (req, res) => {
  res.json(feedback);
});

// POST feedback del servicio
app.post("/feedback", (req, res) => {
  const { correo, eficienciaPrestamo, colaboradores, configuracionIpads, comentario } = req.body;
  const valoresPermitidos = ["", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];

  if (!correoInstitucionalValido(correo)) {
    return res.status(400).json({ error: "El correo debe pertenecer al dominio @colamericano.edu.co" });
  }

  if (![eficienciaPrestamo, colaboradores, configuracionIpads].every(valor => valoresPermitidos.includes(String(valor || "")))) {
    return res.status(400).json({ error: "Calificacion invalida" });
  }

  const nuevoFeedback = {
    id: Date.now(),
    creadoEn: new Date().toISOString(),
    correo: String(correo || "").trim(),
    eficienciaPrestamo: String(eficienciaPrestamo || ""),
    colaboradores: String(colaboradores || ""),
    configuracionIpads: String(configuracionIpads || ""),
    comentario: String(comentario || "").trim()
  };

  feedback.push(nuevoFeedback);
  guardarFeedback();

  res.json({ message: "Feedback guardado", feedback: nuevoFeedback });
});

// POST bloquear horario (solo admin)
app.post("/bloqueos", requerirAdmin, (req, res) => {
  const { fecha, hour } = req.body;

  if (!fecha) {
    return res.status(400).json({ error: "Falta la fecha" });
  }

  // Verificar si ya existe ese bloqueo
  const existe = bloqueos.find(b => b.fecha === fecha && b.hour === hour);
  if (existe) {
    return res.status(400).json({ error: "Ese horario ya está bloqueado" });
  }

  const nuevo = {
    id: Date.now(),
    fecha,
    hour: hour || null
  };

  bloqueos.push(nuevo);
  guardarBloqueos();

  res.json({ message: "Horario bloqueado ✅", bloqueo: nuevo });
});

// DELETE desbloquear horario (solo admin)
app.delete("/bloqueos/:id", requerirAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const index = bloqueos.findIndex(b => b.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Bloqueo no encontrado" });
  }

  bloqueos.splice(index, 1);
  guardarBloqueos();

  res.json({ message: "Bloqueo eliminado ✅" });
});

// POST login usuarios internos
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const usuario = String(username || "").trim().toLowerCase();

  if (loginBloqueado(req, username)) {
    return res.status(429).json({ error: "Demasiados intentos. Intenta de nuevo más tarde." });
  }

  if (validarAdmin(username, password)) {
    limpiarIntentosLogin(req, username);
    return res.json({
      token: crearTokenSesion({ rol: "admin", usuario: adminConfig.username || "admin" }),
      rol: "admin",
      usuario: adminConfig.username || "admin"
    });
  }

  if (validarCoordinador(username, password)) {
    limpiarIntentosLogin(req, username);
    return res.json({
      token: crearTokenSesion({ rol: "coordinador", usuario }),
      rol: "coordinador",
      usuario
    });
  }

  registrarLoginFallido(req, username);
  res.status(401).json({ error: "Credenciales incorrectas ❌" });
});

// =======================
// INICIAR SERVIDOR
// =======================
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
