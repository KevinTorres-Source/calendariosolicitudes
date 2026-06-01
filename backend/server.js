const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;
const MAX_DISPOSITIVOS_POR_DIA = parseInt(process.env.MAX_DISPOSITIVOS_POR_DIA || "70", 10);
const DEFAULT_SOLICITUDES_POR_HORA = parseInt(process.env.DEFAULT_SOLICITUDES_POR_HORA || "2", 10);
const RESERVAS_FILE = path.join(__dirname, "reservas.json");
const BLOQUEOS_FILE = path.join(__dirname, "bloqueos.json");
const FEEDBACK_FILE = path.join(__dirname, "feedback.json");
const LIMITES_SOLICITUDES_FILE = path.join(__dirname, "limites-solicitudes.json");
const LIMITES_DISPOSITIVOS_FILE = path.join(__dirname, "limites-dispositivos.json");
const ADMIN_CONFIG_FILE = path.join(__dirname, "admin-config.json");
const COORDINATOR_TOKEN = "coordinador-token-seguro";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

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
  passwordHash: "$2b$10$IW1IobwePGQhsY2xNoULUu730tBSGQk15Eob8FNtqci3bzpTxa3G2",
  coordinators: [
    { username: "preescolar", passwordHash: "$2b$10$eQwCaqFWcs6KpwvmXULEMe35xnbMJiYlRcbgQGQLuurrSV/hLXb7O" },
    { username: "secundaria", passwordHash: "$2b$10$eQwCaqFWcs6KpwvmXULEMe35xnbMJiYlRcbgQGQLuurrSV/hLXb7O" },
    { username: "primaria", passwordHash: "$2b$10$eQwCaqFWcs6KpwvmXULEMe35xnbMJiYlRcbgQGQLuurrSV/hLXb7O" }
  ]
};

try {
  const data = fs.readFileSync(RESERVAS_FILE, "utf-8");
  reservas = JSON.parse(data);
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

function obtenerRolDesdeToken(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader === "admin-token-seguro") return "admin";
  if (authHeader === COORDINATOR_TOKEN) return "coordinador";
  return "profesor";
}

function requerirAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== "admin-token-seguro") {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

function fechaISO(fecha) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const inicio = obtenerInicioSemana(hoy);
  const fin = new Date(inicio);
  fin.setDate(inicio.getDate() + 13);
  fin.setHours(23, 59, 59, 999);

  const [year, month, day] = String(fecha || "").split("-").map(Number);
  const objetivo = new Date(year, month - 1, day);
  objetivo.setHours(12, 0, 0, 0);

  return fechaISO(objetivo) === fecha && objetivo >= inicio && objetivo <= fin;
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

  const texto = [
    "Su solicitud de prestamo de iPads quedo registrada.",
    "",
    `Nombre: ${reserva.usuario}`,
    `Correo: ${reserva.correo}`,
    `Fecha: ${reserva.fecha}`,
    `Hora: ${reserva.hour}`,
    `Curso / Grado: ${reserva.curso}`,
    `Cantidad de iPads: ${reserva.cantidad}`,
    `Informacion adicional: ${reserva.nota || "N/A"}`,
    `Estado: ${reserva.estado}`
  ].join("\n");

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: reserva.correo,
    subject: "Confirmacion de solicitud de iPads",
    text: texto
  });

  return { enviado: true };
}

function contarDispositivosReservados(fecha, excluirId = null) {
  return reservas
    .filter(r => r.fecha === fecha && r.id !== excluirId && r.estado !== "rechazado")
    .reduce((total, r) => total + (parseInt(r.cantidad, 10) || 0), 0);
}

function obtenerMaxDispositivosPorDia(fecha) {
  const limiteDia = limitesDispositivos.find(item => item.fecha === fecha);
  const limite = parseInt(limiteDia?.limite, 10);
  return Number.isInteger(limite) && limite > 0 ? limite : MAX_DISPOSITIVOS_POR_DIA;
}

function validarCapacidadDiaria(fecha, cantidad, excluirId = null) {
  const cantidadSolicitada = parseInt(cantidad, 10);

  if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada <= 0) {
    return { error: "Ingresa una cantidad valida de dispositivos" };
  }

  const usados = contarDispositivosReservados(fecha, excluirId);
  const disponibles = obtenerMaxDispositivosPorDia(fecha) - usados;

  if (cantidadSolicitada > disponibles) {
    return {
      error: "No hay suficientes iPads disponibles para ese dia."
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

function validarSolicitudReserva({ fecha, hour, equipo, usuario, cantidad, correo }, rol = "profesor") {
  if (!fecha || !hour || !equipo || !usuario || !correo) {
    return { error: "Faltan datos obligatorios" };
  }

  if (!["admin", "coordinador"].includes(rol) && !estaEnVentanaReservaProfesor(fecha)) {
    return { error: "Solo puedes agendar en la semana actual o la siguiente." };
  }

  if (!correoInstitucionalValido(correo)) {
    return { error: "El correo debe pertenecer al dominio @colamericano.edu.co" };
  }

  const capacidad = validarCapacidadDiaria(fecha, cantidad);
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
  res.json(reservas);
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
  const { fecha, hour, equipo, usuario, curso, cantidad, correo, nota } = req.body;

  const validacion = validarSolicitudReserva(req.body, obtenerRolDesdeToken(req));
  if (validacion.error) {
    return res.status(400).json({ error: validacion.error });
  }

  const nuevaReserva = {
    id: Date.now(), // ID único basado en timestamp
    creadoEn: new Date().toISOString(),
    fecha,
    hour,
    equipo,
    usuario,
    curso: curso || "",
    cantidad: validacion.capacidad.cantidadSolicitada,
    correo: String(correo || "").trim(),
    nota: nota || "",
    estado: "aprobado"
  };

  reservas.push(nuevaReserva);
  guardarReservas();
  await enviarCorreoReserva(nuevaReserva);

  res.json({ message: "Reserva creada ✅", reserva: nuevaReserva });
});

// PUT cambiar estado de reserva (solo admin)
app.put("/reservas/:id", requerirAdmin, (req, res) => {
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
    const capacidad = validarCapacidadDiaria(reserva.fecha, reserva.cantidad, reserva.id);
    if (capacidad.error) {
      return res.status(400).json({ error: capacidad.error });
    }
  }

  reserva.estado = estado;
  guardarReservas();

  res.json({ message: "Estado actualizado ✅", reserva });
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
  const { wifi, colaboradores, dispositivos, comentario } = req.body;
  const valoresPermitidos = ["", "1", "2", "3", "4", "5"];

  if (![wifi, colaboradores, dispositivos].every(valor => valoresPermitidos.includes(String(valor || "")))) {
    return res.status(400).json({ error: "Calificacion invalida" });
  }

  const nuevoFeedback = {
    id: Date.now(),
    creadoEn: new Date().toISOString(),
    wifi: String(wifi || ""),
    colaboradores: String(colaboradores || ""),
    dispositivos: String(dispositivos || ""),
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

// POST login usuarios internos (básico, sin JWT por ahora)
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const usuario = String(username || "").trim().toLowerCase();

  if (validarAdmin(username, password)) {
    return res.json({ token: "admin-token-seguro", rol: "admin", usuario: adminConfig.username || "admin" });
  }

  if (validarCoordinador(username, password)) {
    return res.json({ token: COORDINATOR_TOKEN, rol: "coordinador", usuario });
  }

  res.status(401).json({ error: "Credenciales incorrectas ❌" });
});

// =======================
// INICIAR SERVIDOR
// =======================
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
