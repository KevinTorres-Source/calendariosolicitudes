const API = window.location.port === "3000" ? window.location.origin : "http://localhost:3000";

const hoy = new Date();
let fechaActual = new Date();

let token     = localStorage.getItem("token") || null;
let rol       = localStorage.getItem("rol") || "profesor";
let usuarioSesion = localStorage.getItem("usuarioSesion") || "";
let modoAdmin = localStorage.getItem("modoAdmin") === "true";

let pendingFecha = null;
let pendingHour  = null;
let pendingReservaPayload = null;
let confirmandoResponsabilidad = false;
let pendingConfirmacionAdmin = null;
let pendingLimiteContexto = null;
let pendingAdminReservasHorario = [];
let pendingAdminFecha = null;
let pendingAdminHour = null;
let backendDisponible = false;
let maxDispositivosPorDia = 70;
let solicitudesPorHoraDefault = 2;

const hours = [
  "07:15-08:00",
  "08:00-08:45",
  "08:45-09:30",
  "09:30-09:50",
  "09:50-10:35",
  "10:35-11:25",
  "11:25-12:20",
  "12:20-13:10",
  "13:10-14:00",
  "14:00-15:00",
];

const mesesMini = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const festivosColombia = new Set([
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

function esMismaFecha(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function fechaISO(fecha) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function esFestivoColombia(fecha) {
  return festivosColombia.has(String(fecha || ""));
}

function obtenerFechaSemanaEscolar(fecha) {
  const base = new Date(fecha);
  const dia = base.getDay();

  if (dia === 6) base.setDate(base.getDate() + 2);
  if (dia === 0) base.setDate(base.getDate() + 1);

  return base;
}

function obtenerFechaInicialMes(year, month) {
  if (hoy.getFullYear() === year && hoy.getMonth() === month) {
    return new Date(hoy);
  }

  const primera = new Date(year, month, 1);
  return obtenerFechaSemanaEscolar(primera);
}

function obtenerInicioSemana(fecha) {
  const dia = fecha.getDay();
  const lunes = new Date(fecha);
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(fecha.getDate() - (dia === 0 ? 6 : dia - 1));
  return lunes;
}

function estaEnVentanaReservaProfesor(fecha) {
  const inicio = obtenerInicioSemana(hoy);
  const fin = new Date(inicio);
  fin.setDate(inicio.getDate() + 13);
  fin.setHours(23, 59, 59, 999);

  const objetivo = new Date(fecha);
  objetivo.setHours(12, 0, 0, 0);

  return objetivo >= inicio && objetivo <= fin;
}

function tieneReservaExtendida() {
  return modoAdmin || rol === "coordinador";
}

function correoInstitucionalValido(correo) {
  return /^[^\s@]+@colamericano\.edu\.co$/i.test(String(correo || "").trim());
}

// =======================
// STORAGE LOCAL
// =======================
function leerReservasLocal() {
  try { return JSON.parse(localStorage.getItem("reservas") || "[]"); } catch { return []; }
}
function guardarReservasLocal(r) { localStorage.setItem("reservas", JSON.stringify(r)); }
function leerBloqueosLocal() {
  try { return JSON.parse(localStorage.getItem("bloqueos") || "[]"); } catch { return []; }
}
function guardarBloqueosLocal(b) { localStorage.setItem("bloqueos", JSON.stringify(b)); }
function leerLimitesSolicitudesLocal() {
  try { return JSON.parse(localStorage.getItem("limitesSolicitudes") || "[]"); } catch { return []; }
}
function guardarLimitesSolicitudesLocal(l) { localStorage.setItem("limitesSolicitudes", JSON.stringify(l)); }
function leerLimitesDispositivosLocal() {
  try { return JSON.parse(localStorage.getItem("limitesDispositivos") || "[]"); } catch { return []; }
}
function guardarLimitesDispositivosLocal(l) { localStorage.setItem("limitesDispositivos", JSON.stringify(l)); }
function leerFeedbackLocal() {
  try { return JSON.parse(localStorage.getItem("feedbackServicio") || "[]"); } catch { return []; }
}
function guardarFeedbackLocal(f) { localStorage.setItem("feedbackServicio", JSON.stringify(f)); }

function contarDispositivosReservados(reservas, fecha, hour, excluirId = null) {
  return reservas
    .filter(r =>
      r.fecha === fecha &&
      r.hour === hour &&
      r.id !== excluirId &&
      r.estado !== "rechazado"
    )
    .reduce((total, r) => total + (parseInt(r.cantidad, 10) || 0), 0);
}

function validarCapacidadHorario(reservas, fecha, hour, cantidad, excluirId = null) {
  const cantidadSolicitada = parseInt(cantidad, 10);
  const usados = contarDispositivosReservados(reservas, fecha, hour, excluirId);
  const disponibles = obtenerMaxDispositivosPorDia(fecha) - usados;

  if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada <= 0) {
    return { error: "Ingresa una cantidad válida ❌" };
  }

  if (cantidadSolicitada > disponibles) {
    return {
      error: "No hay suficientes iPads disponibles para ese horario."
    };
  }

  return { cantidadSolicitada, usados, disponibles };
}

function obtenerMaxDispositivosPorDia(fecha) {
  const limiteDia = leerLimitesDispositivosLocal().find(item => item.fecha === fecha);
  const limite = parseInt(limiteDia?.limite, 10);
  return Number.isInteger(limite) && limite > 0 ? limite : maxDispositivosPorDia;
}

function obtenerLimiteSolicitudesPorHora(fecha) {
  const limiteDia = leerLimitesSolicitudesLocal().find(item => item.fecha === fecha);
  const limite = parseInt(limiteDia?.limite, 10);
  return Number.isInteger(limite) && limite > 0 ? limite : solicitudesPorHoraDefault;
}

function contarSolicitudesPorHorario(reservas, fecha, hour) {
  return reservas.filter(r => r.fecha === fecha && r.hour === hour && r.estado !== "rechazado").length;
}

function validarLimiteSolicitudesHorario(reservas, fecha, hour) {
  const limite = obtenerLimiteSolicitudesPorHora(fecha);
  const usadas = contarSolicitudesPorHorario(reservas, fecha, hour);
  if (usadas >= limite) {
    return { error: `Este horario ya alcanzó el límite de ${limite} solicitudes.` };
  }
  return { limite, usadas, disponibles: limite - usadas };
}

// =======================
// BACKEND
// =======================
async function verificarBackend() {
  try {
    const res = await fetch(`${API}/`, { signal: AbortSignal.timeout(1500) });
    backendDisponible = res.ok;
  } catch { backendDisponible = false; }
}

async function obtenerConfig() {
  if (!backendDisponible) return;

  try {
    const res = await fetch(`${API}/config`);
    const data = await res.json();
    if (Number.isInteger(data.maxDispositivosPorDia) && data.maxDispositivosPorDia > 0) {
      maxDispositivosPorDia = data.maxDispositivosPorDia;
    }
    if (Number.isInteger(data.solicitudesPorHoraDefault) && data.solicitudesPorHoraDefault > 0) {
      solicitudesPorHoraDefault = data.solicitudesPorHoraDefault;
    }
  } catch {}
}

async function obtenerReservas() {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/reservas`);
      const data = await res.json();
      if (Array.isArray(data)) {
        guardarReservasLocal(data);
        return data;
      }
    } catch {}
  }
  return leerReservasLocal();
}

async function obtenerBloqueos() {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/bloqueos`);
      const data = await res.json();
      guardarBloqueosLocal(data);
      return data;
    } catch {}
  }
  return leerBloqueosLocal();
}

async function obtenerLimitesSolicitudes() {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-solicitudes`);
      const data = await res.json();
      guardarLimitesSolicitudesLocal(data);
      return data;
    } catch {}
  }
  return leerLimitesSolicitudesLocal();
}

async function obtenerLimitesDispositivos() {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-dispositivos`);
      const data = await res.json();
      guardarLimitesDispositivosLocal(data);
      return data;
    } catch {}
  }
  return leerLimitesDispositivosLocal();
}

async function crearReservaAPI(payload) {
  const reservas = leerReservasLocal();
  if (esFestivoColombia(payload.fecha)) return { error: "No se pueden hacer solicitudes en festivos." };
  const limiteHorario = validarLimiteSolicitudesHorario(reservas, payload.fecha, payload.hour);
  if (limiteHorario.error) return { error: limiteHorario.error };
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === payload.fecha && (b.hour === payload.hour || b.hour === null)))
    return { error: "Este horario está bloqueado 🚫" };
  const capacidad = validarCapacidadHorario(reservas, payload.fecha, payload.hour, payload.cantidad);
  if (capacidad.error) return { error: capacidad.error };

  let nueva = {
    id: Date.now(),
    creadoEn: new Date().toISOString(),
    ...payload,
    cantidad: capacidad.cantidadSolicitada,
    estado: "aprobado"
  };

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/reservas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token || "" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) return data;
      nueva = data.reserva || nueva;
    } catch {}
  }

  const existenteIndex = reservas.findIndex(reserva =>
    reserva.id === nueva.id ||
    (nueva.clientRequestId && reserva.clientRequestId === nueva.clientRequestId)
  );
  if (existenteIndex === -1) {
    reservas.push(nueva);
  } else {
    reservas[existenteIndex] = nueva;
  }
  guardarReservasLocal(reservas);
  return { message: "OK", reserva: nueva };
}

async function validarReservaAPI(payload) {
  const reservas = leerReservasLocal();
  if (esFestivoColombia(payload.fecha)) return { error: "No se pueden hacer solicitudes en festivos." };
  const limiteHorario = validarLimiteSolicitudesHorario(reservas, payload.fecha, payload.hour);
  if (limiteHorario.error) return { error: limiteHorario.error };
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === payload.fecha && (b.hour === payload.hour || b.hour === null)))
    return { error: "Este horario está bloqueado 🚫" };
  const capacidad = validarCapacidadHorario(reservas, payload.fecha, payload.hour, payload.cantidad);
  if (capacidad.error) return { error: capacidad.error };

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/reservas/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token || "" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  return { message: "OK" };
}

async function bloquearAPI(fecha, hour) {
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === fecha && b.hour === hour))
    return { error: "Ese horario ya está bloqueado" };
  const nuevo = { id: Date.now(), fecha, hour: hour || null };
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/bloqueos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token },
        body: JSON.stringify({ fecha, hour })
      });
      const data = await res.json();
      if (data.error) return data;
      nuevo.id = data.bloqueo?.id || nuevo.id;
    } catch {}
  }
  bloqueos.push(nuevo);
  guardarBloqueosLocal(bloqueos);
  return { message: "OK" };
}

async function enviarFeedbackAPI(payload) {
  const feedback = leerFeedbackLocal();
  const nuevo = { id: Date.now(), creadoEn: new Date().toISOString(), ...payload };

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) return data;
      nuevo.id = data.feedback?.id || nuevo.id;
      nuevo.creadoEn = data.feedback?.creadoEn || nuevo.creadoEn;
    } catch {}
  }

  feedback.push(nuevo);
  guardarFeedbackLocal(feedback);
  return { message: "OK", feedback: nuevo };
}

async function obtenerFeedbackAdmin() {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/feedback`, {
        headers: { "Authorization": token || "" }
      });
      const data = await res.json();
      if (data.error) return data;
      guardarFeedbackLocal(data);
      return data;
    } catch {}
  }

  return leerFeedbackLocal();
}

async function obtenerSolicitudesRecientesAdmin(limite = 20) {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/reservas/recientes?limit=${limite}`, {
        headers: { "Authorization": token || "" }
      });
      const data = await res.json();
      if (data.error) return data;
      if (Array.isArray(data)) return data;
    } catch {}
  }

  return leerReservasLocal()
    .slice()
    .sort((a, b) => {
      const fechaB = Date.parse(b.creadoEn || "") || parseInt(b.id, 10) || 0;
      const fechaA = Date.parse(a.creadoEn || "") || parseInt(a.id, 10) || 0;
      return fechaB - fechaA;
    })
    .slice(0, limite);
}

async function desbloquearAPI(bloqueoId) {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/bloqueos/${bloqueoId}`, {
        method: "DELETE",
        headers: { "Authorization": token || "" }
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  guardarBloqueosLocal(leerBloqueosLocal().filter(b => b.id !== bloqueoId));
  return { message: "OK" };
}

async function guardarLimiteSolicitudesAPI(fecha, limite) {
  const limites = leerLimitesSolicitudesLocal().filter(item => item.fecha !== fecha);
  const nuevo = { fecha, limite };

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-solicitudes/${fecha}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": token || "" },
        body: JSON.stringify({ limite })
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  limites.push(nuevo);
  guardarLimitesSolicitudesLocal(limites);
  return { message: "OK", limite: nuevo };
}

async function restablecerLimiteSolicitudesAPI(fecha) {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-solicitudes/${fecha}`, {
        method: "DELETE",
        headers: { "Authorization": token || "" }
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  guardarLimitesSolicitudesLocal(leerLimitesSolicitudesLocal().filter(item => item.fecha !== fecha));
  return { message: "OK" };
}

async function guardarLimiteDispositivosAPI(fecha, limite) {
  const limites = leerLimitesDispositivosLocal().filter(item => item.fecha !== fecha);
  const nuevo = { fecha, limite };

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-dispositivos/${fecha}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": token || "" },
        body: JSON.stringify({ limite })
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  limites.push(nuevo);
  guardarLimitesDispositivosLocal(limites);
  return { message: "OK", limite: nuevo };
}

async function restablecerLimiteDispositivosAPI(fecha) {
  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/limites-dispositivos/${fecha}`, {
        method: "DELETE",
        headers: { "Authorization": token || "" }
      });
      const data = await res.json();
      if (data.error) return data;
    } catch {}
  }

  guardarLimitesDispositivosLocal(leerLimitesDispositivosLocal().filter(item => item.fecha !== fecha));
  return { message: "OK" };
}

// =======================
// ADMIN
// =======================
async function loginAdmin() {
  window.location.href = "login.html";
}

function logout() {
  token = null; rol = "profesor"; usuarioSesion = ""; modoAdmin = false;
  localStorage.removeItem("token");
  localStorage.removeItem("rol");
  localStorage.removeItem("usuarioSesion");
  localStorage.removeItem("modoAdmin");
  actualizarBotonesAdmin();
  cerrarPanelAdmin();
  cerrarSolicitudesRecientes();
  renderSemana();
}

function actualizarBotonesAdmin() {
  const sesionActiva = modoAdmin || rol === "coordinador";
  const sessionUserBadge = document.getElementById("sessionUserBadge");
  document.getElementById("btnAdmin").style.display  = sesionActiva ? "none"  : "block";
  document.getElementById("btnPanelAdmin").style.display = modoAdmin ? "block" : "none";
  document.getElementById("btnSolicitudesRecientes").style.display = modoAdmin ? "block" : "none";
  document.getElementById("btnLogout").style.display = sesionActiva ? "block" : "none";
  sessionUserBadge.style.display = sesionActiva ? "block" : "none";
  sessionUserBadge.textContent = (usuarioSesion || rol).toUpperCase();
}

// =======================
// MODAL
// =======================
function abrirModal(fecha, hour) {
  pendingFecha = fecha;
  pendingHour  = hour;
  const [y, m, d] = fecha.split("-");
  const fo = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  const ft = fo.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("modalFechaHora").textContent =
    `📅 ${ft.charAt(0).toUpperCase() + ft.slice(1)}  ·  🕐 ${hour}`;
  ["inputNombre","inputCantidad","inputCurso","inputCorreo","inputNota"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("solicitudStatus").textContent = "";
  document.getElementById("modalOverlay").style.display = "flex";
}

function cerrarModal() {
  document.getElementById("modalOverlay").style.display = "none";
  pendingFecha = pendingHour = pendingReservaPayload = null;
}

function mostrarErrorSolicitud(mensaje, inputId = null) {
  document.getElementById("solicitudStatus").textContent = mensaje;
  if (inputId) document.getElementById(inputId).focus();
}

function esErrorLimiteSolicitudes(mensaje) {
  return String(mensaje || "").includes("alcanzó el límite");
}

async function confirmarReserva() {
  const nombre   = document.getElementById("inputNombre").value.trim();
  const cantidad = document.getElementById("inputCantidad").value.trim();
  const curso    = document.getElementById("inputCurso").value.trim();
  const correo   = document.getElementById("inputCorreo").value.trim();
  const nota     = document.getElementById("inputNota").value.trim();

  document.getElementById("solicitudStatus").textContent = "";

  if (!nombre) { mostrarErrorSolicitud("El nombre es obligatorio.", "inputNombre"); return; }
  if (!cantidad || isNaN(cantidad) || parseInt(cantidad) <= 0) {
    mostrarErrorSolicitud("Ingresa una cantidad valida.", "inputCantidad");
    return;
  }
  if (!curso) { mostrarErrorSolicitud("El curso es obligatorio.", "inputCurso"); return; }
  if (!correoInstitucionalValido(correo)) {
    mostrarErrorSolicitud("Ingresa un correo valido con dominio @colamericano.edu.co.", "inputCorreo");
    return;
  }

  const payload = {
    clientRequestId: window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fecha: pendingFecha, hour: pendingHour,
    usuario: nombre,
    equipo: `${cantidad} iPads · ${curso}`,
    curso, cantidad: parseInt(cantidad), correo, nota
  };

  const data = await validarReservaAPI(payload);

  if (data.error) { mostrarErrorSolicitud(data.error); return; }
  pendingReservaPayload = payload;
  document.getElementById("modalOverlay").style.display = "none";
  document.getElementById("responsabilidadOverlay").style.display = "flex";
}

function cancelarResponsabilidad() {
  if (confirmandoResponsabilidad) return;
  document.getElementById("responsabilidadOverlay").style.display = "none";
  pendingReservaPayload = null;
  pendingFecha = pendingHour = null;
}

async function aceptarResponsabilidad() {
  if (!pendingReservaPayload || confirmandoResponsabilidad) return;

  confirmandoResponsabilidad = true;
  const boton = document.getElementById("btnAceptarResponsabilidad");
  const cancelar = document.getElementById("btnCancelarResponsabilidad");
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  cancelar.disabled = true;
  boton.textContent = "Enviando solicitud...";

  let data;
  try {
    data = await crearReservaAPI(pendingReservaPayload);
  } catch (error) {
    data = { error: error.message || "No se pudo crear la solicitud." };
  } finally {
    confirmandoResponsabilidad = false;
    boton.disabled = false;
    cancelar.disabled = false;
    boton.textContent = textoOriginal;
  }

  if (data.error) {
    if (!esErrorLimiteSolicitudes(data.error)) alert(data.error);
    cancelarResponsabilidad();
    renderSemana();
    return;
  }

  document.getElementById("responsabilidadOverlay").style.display = "none";
  pendingReservaPayload = null;
  pendingFecha = pendingHour = null;
  renderSemana();
}

// =======================
// MINI CALENDARIO
// =======================
function renderMiniCalendar() {
  const miniDias = document.getElementById("miniCalendar");
  const monthLabel = document.getElementById("miniMonthLabel");
  const monthOptions = document.getElementById("miniMonthOptions");
  const yearLabel = document.getElementById("miniCalendarYear");

  const year  = fechaActual.getFullYear();
  const month = fechaActual.getMonth();

  if (monthLabel) monthLabel.textContent = mesesMini[month];
  if (yearLabel) yearLabel.textContent = year;
  if (monthOptions) {
    monthOptions.querySelectorAll(".mini-month-option").forEach(option => {
      option.classList.toggle("active", parseInt(option.dataset.month, 10) === month);
    });
  }

  miniDias.innerHTML = "";
  ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].forEach(nombreDia => {
    const header = document.createElement("div");
    header.className = "mini-weekday";
    header.textContent = nombreDia;
    miniDias.appendChild(header);
  });

  const primerDia = new Date(year, month, 1).getDay();
  const diasMes   = new Date(year, month + 1, 0).getDate();
  const offset    = primerDia === 0 ? 6 : primerDia - 1;

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "day-mini-empty";
    miniDias.appendChild(empty);
  }

  for (let d = 1; d <= diasMes; d++) {
    const day = document.createElement("div");
    day.className   = "day-mini";
    day.textContent = d;
    const f = new Date(year, month, d);
    if (esMismaFecha(f, hoy)) day.classList.add("today");
    if (esMismaFecha(f, fechaActual)) day.classList.add("selected");
    day.onclick = () => {
      fechaActual = new Date(year, month, d);
      renderMiniCalendar();
      renderSemana();
    };
    miniDias.appendChild(day);
  }
}

// =======================
// SEMANA
// =======================
function obtenerSemana(fecha) {
  const dia   = fecha.getDay();
  const lunes = new Date(fecha);
  lunes.setDate(fecha.getDate() - (dia === 0 ? 6 : dia - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });
}

function formatearTituloSemana(dias) {
  if (!dias.length) return "";

  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  const mesNombre = primero.toLocaleDateString("en-US", { month: "long" });
  const year = primero.getFullYear();

  if (primero.getDate() === ultimo.getDate()) {
    return `${mesNombre} ${primero.getDate()}, ${year}`;
  }

  return `${mesNombre} ${primero.getDate()} - ${ultimo.getDate()}, ${year}`;
}

function renderReservasHorario(reservasHorario) {
  if (!reservasHorario.length) return "";

  return reservasHorario.map(reserva => {
    const detalleIpads = modoAdmin
      ? `<span class="cell-reserva-ipads">${escaparHTML(reserva.cantidad || "0")} iPads</span>`
      : "";
    return `
      <span class="cell-reserva-item">
        <span class="cell-reserva-persona">${escaparHTML(reserva.usuario)}${reserva.curso ? ` - ${escaparHTML(reserva.curso)}` : ""}</span>
        ${detalleIpads}
      </span>`;
  }).join("");
}

async function renderSemana() {
  const calendar = document.getElementById("calendar");
  const titulo   = document.getElementById("semanaActual");
  const mesSeleccionado = fechaActual.getMonth();
  const yearSeleccionado = fechaActual.getFullYear();

  calendar.innerHTML = '<div class="cargando">Cargando horarios...</div>';

  const [reservas, bloqueos] = await Promise.all([
    obtenerReservas(),
    obtenerBloqueos(),
    obtenerLimitesSolicitudes(),
    obtenerLimitesDispositivos()
  ]);

  calendar.innerHTML = "";

  const semana = obtenerSemana(obtenerFechaSemanaEscolar(fechaActual));
  const diasDelMesSeleccionado = semana.filter(fecha =>
    fecha.getMonth() === mesSeleccionado &&
    fecha.getFullYear() === yearSeleccionado
  );
  titulo.textContent = formatearTituloSemana(diasDelMesSeleccionado);

  semana.forEach(fecha => {
    let dayName = fecha.toLocaleDateString("en-US", { weekday: "long" });
    dayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const fechaStr = fechaISO(fecha);
    const perteneceAlMesSeleccionado =
      fecha.getMonth() === mesSeleccionado &&
      fecha.getFullYear() === yearSeleccionado;
    const disponibleParaProfesor = estaEnVentanaReservaProfesor(fecha);
    const esFestivo = esFestivoColombia(fechaStr);

    const bloqueadoDiaCompleto = bloqueos.find(b => b.fecha === fechaStr && b.hour === null);

    const col = document.createElement("div");
    col.className = "day-column";
    if (!perteneceAlMesSeleccionado) col.classList.add("outside-month");
    if (perteneceAlMesSeleccionado && esFestivo) col.classList.add("holiday-day");
    if (perteneceAlMesSeleccionado && !tieneReservaExtendida() && !disponibleParaProfesor) {
      col.classList.add("out-of-time-day");
    }

    const h4 = document.createElement("h4");
    h4.className = "day-column-header";
    if (modoAdmin && perteneceAlMesSeleccionado) h4.classList.add("admin-day-header");
    const monthShort = fecha.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
    const title = document.createElement("span");
    title.textContent = perteneceAlMesSeleccionado
      ? `${dayName} ${fecha.getDate()}`
      : `${dayName} ${monthShort} ${fecha.getDate()}`;
    h4.appendChild(title);

    if (modoAdmin && perteneceAlMesSeleccionado) {
      const adminHeaderControls = document.createElement("div");
      adminHeaderControls.className = "day-admin-controls";

      const blockDayButton = document.createElement("button");
      blockDayButton.className = "btn-block-day";
      blockDayButton.type = "button";
      blockDayButton.textContent = bloqueadoDiaCompleto ? "\uD83D\uDD12" : "\uD83D\uDD13";
      blockDayButton.title = bloqueadoDiaCompleto ? "Unblock day" : "Block day";
      blockDayButton.setAttribute("aria-label", bloqueadoDiaCompleto ? "Unblock day" : "Block day");
      blockDayButton.classList.toggle("active", Boolean(bloqueadoDiaCompleto));
      blockDayButton.addEventListener("click", event => {
        event.stopPropagation();
        if (bloqueadoDiaCompleto) desbloquearDia(bloqueadoDiaCompleto);
        else bloquearDia(fechaStr);
      });

      const limiteDayButton = document.createElement("button");
      limiteDayButton.className = "btn-day-limit";
      limiteDayButton.type = "button";
      limiteDayButton.textContent = `${obtenerLimiteSolicitudesPorHora(fechaStr)}x`;
      limiteDayButton.title = "Cambiar solicitudes permitidas por hora";
      limiteDayButton.setAttribute("aria-label", "Cambiar solicitudes permitidas por hora");
      limiteDayButton.addEventListener("click", event => {
        event.stopPropagation();
        cambiarLimiteSolicitudesDia(fechaStr);
      });

      const dispositivosDayButton = document.createElement("button");
      dispositivosDayButton.className = "btn-day-devices";
      dispositivosDayButton.type = "button";
      dispositivosDayButton.textContent = `${obtenerMaxDispositivosPorDia(fechaStr)}`;
      dispositivosDayButton.title = "Cambiar iPads disponibles para este día";
      dispositivosDayButton.setAttribute("aria-label", "Cambiar iPads disponibles para este día");
      dispositivosDayButton.addEventListener("click", event => {
        event.stopPropagation();
        cambiarLimiteDispositivosDia(fechaStr);
      });
      adminHeaderControls.appendChild(dispositivosDayButton);
      adminHeaderControls.appendChild(limiteDayButton);
      adminHeaderControls.appendChild(blockDayButton);
      h4.appendChild(adminHeaderControls);
    }

    col.appendChild(h4);

    hours.forEach(hour => {
      const cell = document.createElement("div");
      cell.className = "cell";

      if (!perteneceAlMesSeleccionado) {
        cell.classList.add("fuera-mes");
        cell.innerHTML = `<span class="cell-hora">${hour}</span><span class="cell-libre">Not part of this month</span>`;
        col.appendChild(cell);
        return;
      }

      const reservasHorario = reservas.filter(r =>
        r.fecha === fechaStr && r.hour === hour && r.estado !== "rechazado");
      const limiteHorario = obtenerLimiteSolicitudesPorHora(fechaStr);
      const solicitudesUsadas = reservasHorario.length;

      if (esFestivo) {
        cell.classList.add("holiday");
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-libre">Holiday</span>
          </div>
          ${reservasHorario.length ? `
            <div class="cell-row cell-row-info">
              <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
              <span class="cell-detalle">📋 ${solicitudesUsadas}/${limiteHorario}</span>
            </div>` : ""}`;
        col.appendChild(cell);
        return;
      }

      if (!tieneReservaExtendida() && !disponibleParaProfesor) {
        cell.classList.add("out-of-time");
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-libre">Out of time</span>
          </div>
          ${reservasHorario.length ? `
            <div class="cell-row cell-row-info">
              <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
              <span class="cell-detalle">📋 ${solicitudesUsadas}/${limiteHorario}</span>
            </div>` : ""}`;
        col.appendChild(cell);
        return;
      }

      const bloqueado = bloqueadoDiaCompleto || bloqueos.find(b =>
        b.fecha === fechaStr && (b.hour === hour || b.hour === null));
      const reserva = reservasHorario[0];
      const horarioLleno = solicitudesUsadas >= limiteHorario;

      if (bloqueado) {
        cell.classList.add("bloqueado");
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-estado">
              <span class="lock-vector" aria-hidden="true"></span>
              <span>Bloqueado</span>
            </span>
          </div>
          ${reservasHorario.length ? `
            <div class="cell-row cell-row-info">
              <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
            </div>` : ""}`;
        if (modoAdmin) {
          cell.classList.add("desbloqueable");
          cell.addEventListener("click", () => {
            if (bloqueado.hour === null) desbloquearDia(bloqueado);
            else desbloquearHorario(bloqueado);
          });
        }
      } else if (horarioLleno && reserva) {
        cell.classList.add(reserva.estado || "pendiente");
        cell.classList.add("sin-cupo");
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-libre">Not available</span>
          </div>
          <div class="cell-row cell-row-info">
            <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
            <span class="cell-detalle">📋 ${solicitudesUsadas}/${limiteHorario}</span>
          </div>`;
        if (modoAdmin) {
          cell.style.cursor = "pointer";
          cell.addEventListener("click", () => mostrarOpcionesAdmin(reservasHorario, fechaStr, hour));
        }
      } else {
        cell.classList.add("disponible");
        if (solicitudesUsadas > 0) cell.classList.add("con-solicitud");
        const textoCupo = `${solicitudesUsadas}/${limiteHorario}`;
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-libre">Available</span>
          </div>
          <div class="cell-row cell-row-info">
            <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
            <span class="cell-detalle">📋 ${textoCupo}</span>
          </div>`;
        cell.addEventListener("click", () => {
          if (modoAdmin && solicitudesUsadas) mostrarOpcionesAdmin(reservasHorario, fechaStr, hour);
          else if (modoAdmin) bloquearHorario(fechaStr, hour);
          else abrirModal(fechaStr, hour);
        });
      }

      col.appendChild(cell);
    });

    calendar.appendChild(col);
  });
}

// =======================
// ADMIN OPCIONES
// =======================
function mostrarOpcionesAdmin(reservaOLista, fecha, hour) {
  const reservas = Array.isArray(reservaOLista)
    ? reservaOLista
    : leerReservasLocal().filter(r => r.id === reservaOLista);
  if (!reservas.length) return;

  pendingAdminReservasHorario = reservas;
  pendingAdminFecha = fecha || reservas[0].fecha;
  pendingAdminHour = hour || reservas[0].hour;
  renderModalReservaAdmin();
  document.getElementById("reservaAdminOverlay").style.display = "flex";
}

function renderModalReservaAdmin() {
  const titulo = document.getElementById("reservaAdminTitulo");
  const texto = document.getElementById("reservaAdminTexto");
  const lista = document.getElementById("reservaAdminLista");
  const status = document.getElementById("reservaAdminStatus");

  titulo.textContent = `${pendingAdminFecha} · ${pendingAdminHour}`;
  texto.textContent = "Puedes rechazar una solicitud puntual o bloquear esta hora conservando las reservas ya realizadas.";
  status.textContent = "";

  lista.innerHTML = pendingAdminReservasHorario.map(reserva => `
    <article class="reserva-admin-item">
      <div class="reserva-admin-head">
        <div>
          <span class="reserva-admin-label">Nombre</span>
          <strong>${escaparHTML(reserva.usuario)}</strong>
        </div>
        <button class="btn-reserva-rechazar" type="button" data-reserva-id="${reserva.id}">Rechazar</button>
      </div>
      <div class="reserva-admin-details">
        <div>
          <span class="reserva-admin-label">Curso</span>
          <p>${escaparHTML(reserva.curso || "Sin curso")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Cantidad de iPads</span>
          <p>${escaparHTML(reserva.cantidad || "Sin cantidad")}</p>
        </div>
        <div class="reserva-admin-note">
          <span class="reserva-admin-label">Más información</span>
          <p>${escaparHTML(reserva.nota || "Sin información adicional")}</p>
        </div>
      </div>
    </article>
  `).join("");

  lista.querySelectorAll("[data-reserva-id]").forEach(button => {
    button.addEventListener("click", () => rechazarReservaDesdeModal(parseInt(button.dataset.reservaId, 10)));
  });
}

function cerrarReservaAdmin() {
  document.getElementById("reservaAdminOverlay").style.display = "none";
  pendingAdminReservasHorario = [];
  pendingAdminFecha = null;
  pendingAdminHour = null;
}

async function rechazarReservaDesdeModal(id) {
  const status = document.getElementById("reservaAdminStatus");
  status.textContent = "Rechazando solicitud...";
  await cambiarEstado(id, "rechazado");
  cerrarReservaAdmin();
}

async function bloquearReservaDesdeModal() {
  const status = document.getElementById("reservaAdminStatus");
  if (!pendingAdminFecha || !pendingAdminHour) return;

  status.textContent = "Bloqueando horario...";
  const data = await bloquearAPI(pendingAdminFecha, pendingAdminHour);
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  cerrarReservaAdmin();
  await renderSemana();
}

async function cambiarEstado(id, estado) {
  if (backendDisponible) {
    try {
      await fetch(`${API}/reservas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": token },
        body: JSON.stringify({ estado })
      });
    } catch {}
  }
  const r = leerReservasLocal();
  const x = r.find(v => v.id === id);
  if (x) { x.estado = estado; guardarReservasLocal(r); }
  renderSemana();
}

async function eliminarReserva(id) {
  if (backendDisponible) {
    try {
      await fetch(`${API}/reservas/${id}`, { method: "DELETE", headers: { "Authorization": token } });
    } catch {}
  }
  guardarReservasLocal(leerReservasLocal().filter(x => x.id !== id));
  renderSemana();
}

function abrirConfirmacionAdmin({ titulo, texto, confirmarTexto = "Confirm", onConfirm }) {
  pendingConfirmacionAdmin = onConfirm;
  document.getElementById("confirmacionAdminTitulo").textContent = titulo;
  document.getElementById("confirmacionAdminTexto").textContent = texto;
  document.getElementById("btnAceptarConfirmacionAdmin").textContent = confirmarTexto;
  document.getElementById("confirmacionAdminOverlay").style.display = "flex";
}

function cerrarConfirmacionAdmin() {
  pendingConfirmacionAdmin = null;
  document.getElementById("confirmacionAdminOverlay").style.display = "none";
}

async function aceptarConfirmacionAdmin() {
  if (!pendingConfirmacionAdmin) return;
  const accion = pendingConfirmacionAdmin;
  cerrarConfirmacionAdmin();
  await accion();
}

async function bloquearHorario(fecha, hour) {
  abrirConfirmacionAdmin({
    titulo: "Block time slot",
    texto: `This will block ${hour} on ${fecha}.`,
    confirmarTexto: "Block time",
    onConfirm: async () => {
      const data = await bloquearAPI(fecha, hour);
      if (data.error) {
        abrirConfirmacionAdmin({
          titulo: "Action unavailable",
          texto: data.error,
          confirmarTexto: "OK",
          onConfirm: async () => {}
        });
      } else {
        renderSemana();
      }
    }
  });
}

async function bloquearDia(fecha) {
  abrirConfirmacionAdmin({
    titulo: "Block entire day",
    texto: `This will block every time slot on ${fecha}.`,
    confirmarTexto: "Block day",
    onConfirm: async () => {
      const data = await bloquearAPI(fecha, null);
      if (data.error) {
        abrirConfirmacionAdmin({
          titulo: "Action unavailable",
          texto: data.error,
          confirmarTexto: "OK",
          onConfirm: async () => {}
        });
      } else {
        renderSemana();
      }
    }
  });
}

async function desbloquearHorario(bloqueo) {
  abrirConfirmacionAdmin({
    titulo: "Unblock time slot",
    texto: `This will unlock ${bloqueo.hour} on ${bloqueo.fecha}.`,
    confirmarTexto: "Unblock time",
    onConfirm: async () => {
      const data = await desbloquearAPI(bloqueo.id);
      if (data.error) {
        abrirConfirmacionAdmin({
          titulo: "Action unavailable",
          texto: data.error,
          confirmarTexto: "OK",
          onConfirm: async () => {}
        });
      } else {
        renderSemana();
      }
    }
  });
}

async function desbloquearDia(bloqueo) {
  abrirConfirmacionAdmin({
    titulo: "Unblock entire day",
    texto: `This will unlock every time slot on ${bloqueo.fecha}.`,
    confirmarTexto: "Unblock day",
    onConfirm: async () => {
      const data = await desbloquearAPI(bloqueo.id);
      if (data.error) {
        abrirConfirmacionAdmin({
          titulo: "Action unavailable",
          texto: data.error,
          confirmarTexto: "OK",
          onConfirm: async () => {}
        });
      } else {
        renderSemana();
      }
    }
  });
}

async function cambiarLimiteSolicitudesDia(fecha) {
  abrirModalLimiteDia({
    tipo: "solicitudes",
    fecha,
    kicker: "Solicitudes por hora",
    texto: "Define cuántas solicitudes se permiten por cada hora durante este día.",
    actual: obtenerLimiteSolicitudesPorHora(fecha),
    defaultValue: solicitudesPorHoraDefault
  });
}

async function cambiarLimiteDispositivosDia(fecha) {
  abrirModalLimiteDia({
    tipo: "dispositivos",
    fecha,
    kicker: "iPads disponibles",
    texto: "Define cuántos iPads estarán disponibles durante este día.",
    actual: obtenerMaxDispositivosPorDia(fecha),
    defaultValue: maxDispositivosPorDia
  });
}

function abrirModalLimiteDia({ tipo, fecha, kicker, texto, actual, defaultValue }) {
  pendingLimiteContexto = { tipo, fecha, defaultValue };
  document.getElementById("limiteSolicitudesKicker").textContent = kicker;
  document.getElementById("limiteSolicitudesTitulo").textContent = fecha;
  document.getElementById("limiteSolicitudesTexto").textContent = texto;
  document.getElementById("inputLimiteDia").value = actual;
  document.getElementById("limiteSolicitudesStatus").textContent = "";
  document.getElementById("btnRestablecerLimiteDia").textContent = `Default ${defaultValue}`;
  document.getElementById("limiteSolicitudesOverlay").style.display = "flex";
}

function cerrarLimiteSolicitudes() {
  document.getElementById("limiteSolicitudesOverlay").style.display = "none";
  pendingLimiteContexto = null;
}

function ajustarInputLimite(delta) {
  const input = document.getElementById("inputLimiteDia");
  const actual = parseInt(input.value, 10) || solicitudesPorHoraDefault;
  input.value = Math.max(1, actual + delta);
}

async function guardarLimiteDiaDesdeModal() {
  const limite = parseInt(document.getElementById("inputLimiteDia").value, 10);
  const status = document.getElementById("limiteSolicitudesStatus");

  if (!pendingLimiteContexto) return;
  if (!Number.isInteger(limite) || limite <= 0) {
    status.textContent = "Ingresa un número mayor a 0.";
    return;
  }

  status.textContent = "Guardando...";
  const data = pendingLimiteContexto.tipo === "dispositivos"
    ? await guardarLimiteDispositivosAPI(pendingLimiteContexto.fecha, limite)
    : await guardarLimiteSolicitudesAPI(pendingLimiteContexto.fecha, limite);
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  cerrarLimiteSolicitudes();
  await renderSemana();
}

async function restablecerLimiteDiaDesdeModal() {
  const status = document.getElementById("limiteSolicitudesStatus");
  if (!pendingLimiteContexto) return;

  status.textContent = "Restableciendo...";
  const data = pendingLimiteContexto.tipo === "dispositivos"
    ? await restablecerLimiteDispositivosAPI(pendingLimiteContexto.fecha)
    : await restablecerLimiteSolicitudesAPI(pendingLimiteContexto.fecha);
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  cerrarLimiteSolicitudes();
  await renderSemana();
}
// =======================
// PANEL ADMIN
// =======================
const feedbackPreguntas = [
  { key: "wifi", label: "WiFi network" },
  { key: "colaboradores", label: "Staff support" },
  { key: "dispositivos", label: "Devices" }
];

const feedbackRatingValues = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

const feedbackChartColors = {
  5: "#16a34a",
  4.5: "#22c55e",
  4: "#65a30d",
  3.5: "#eab308",
  3: "#f59e0b",
  2.5: "#f97316",
  2: "#ea580c",
  1.5: "#f43f5e",
  1: "#ef4444"
};

function normalizarFeedbackValor(valor) {
  const numero = parseFloat(valor);
  return feedbackRatingValues.includes(numero) ? numero : null;
}

function formatearRating(valor) {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(1);
}

function renderStars(valor) {
  const rating = Number(valor) || 0;
  const porcentaje = Math.max(0, Math.min(100, (rating / 5) * 100));
  const texto = `${formatearRating(rating)} stars`;
  return `
    <span class="star-rating-readonly" aria-label="${texto}">
      <span class="star-rating-base" aria-hidden="true">★★★★★</span>
      <span class="star-rating-fill" style="width:${porcentaje}%;" aria-hidden="true">★★★★★</span>
    </span>
    <span class="star-rating-label">${formatearRating(rating)}</span>`;
}

function escaparHTML(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cerrarPanelAdmin() {
  document.getElementById("adminOverlay").style.display = "none";
}

async function abrirPanelAdmin() {
  if (!modoAdmin) return;
  document.getElementById("adminOverlay").style.display = "flex";
  await renderPanelFeedback();
}

function cerrarSolicitudesRecientes() {
  document.getElementById("recentRequestsOverlay").style.display = "none";
}

async function abrirSolicitudesRecientes() {
  if (!modoAdmin) return;
  document.getElementById("recentRequestsOverlay").style.display = "flex";
  await renderSolicitudesRecientes();
}

function formatearFechaHoraCreacion(valor) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "Creation time unavailable";

  return fecha.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function obtenerEstadoSolicitud(reserva) {
  const estado = String(reserva.estado || "approved").toLowerCase();
  if (estado === "rechazado") return { label: "Rejected", className: "rejected" };
  if (estado === "pendiente") return { label: "Pending", className: "pending" };
  return { label: "Approved", className: "approved" };
}

function renderSolicitudReciente(reserva) {
  const estado = obtenerEstadoSolicitud(reserva);
  const fecha = escaparHTML(reserva.fecha || "No date");
  const hora = escaparHTML(reserva.hour || "No time");
  const nombre = escaparHTML(reserva.usuario || "Unknown user");
  const mensaje = `${nombre} has made a request for ${fecha} - ${hora}.`;

  return `
    <article class="recent-request-item">
      <div class="recent-request-main">
        <p>${mensaje}</p>
        <time>${escaparHTML(formatearFechaHoraCreacion(reserva.creadoEn))}</time>
      </div>
      <div class="recent-request-meta">
        <span class="recent-request-pill ${estado.className}">${estado.label}</span>
        <span>${escaparHTML(reserva.cantidad || "0")} iPads</span>
        <span>Course ${escaparHTML(reserva.curso || "N/A")}</span>
      </div>
      ${reserva.nota ? `<p class="recent-request-note">${escaparHTML(reserva.nota)}</p>` : ""}
    </article>`;
}

async function renderSolicitudesRecientes() {
  const status = document.getElementById("recentRequestsStatus");
  const lista = document.getElementById("recentRequestsList");
  const total = document.getElementById("recentRequestsTotal");

  status.textContent = "Loading recent requests...";
  lista.innerHTML = "";
  total.textContent = "0 requests";

  const data = await obtenerSolicitudesRecientesAdmin(20);
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  const solicitudes = Array.isArray(data) ? data : [];
  total.textContent = `${solicitudes.length} ${solicitudes.length === 1 ? "request" : "requests"}`;

  if (!solicitudes.length) {
    lista.innerHTML = '<p class="admin-empty">No requests have been recorded yet.</p>';
    status.textContent = "No recent requests.";
    return;
  }

  lista.innerHTML = solicitudes.map(renderSolicitudReciente).join("");
  status.textContent = "Recent requests updated.";
}

function calcularMetricasFeedback(feedback) {
  const conteosGenerales = Object.fromEntries(feedbackRatingValues.map(valor => [valor, 0]));
  const tendencia = feedback
    .map(item => {
      const valores = feedbackPreguntas
        .map(pregunta => normalizarFeedbackValor(item[pregunta.key]))
        .filter(valor => valor !== null);
      valores.forEach(valor => { conteosGenerales[valor] += 1; });
      return {
        creadoEn: item.creadoEn,
        promedio: valores.length ? valores.reduce((sum, valor) => sum + valor, 0) / valores.length : 0
      };
    })
    .filter(item => item.promedio > 0)
    .sort((a, b) => new Date(a.creadoEn || 0) - new Date(b.creadoEn || 0));

  const metricas = feedbackPreguntas.map(pregunta => {
    const valores = feedback
      .map(item => normalizarFeedbackValor(item[pregunta.key]))
      .filter(valor => valor !== null);
    const total = valores.length;
    const promedio = total ? valores.reduce((sum, valor) => sum + valor, 0) / total : 0;
    const conteos = Object.fromEntries(feedbackRatingValues.map(valor => [valor, 0]));
    valores.forEach(valor => { conteos[valor] += 1; });
    return { ...pregunta, valores, total, promedio, conteos };
  });

  const conDatos = metricas.filter(metrica => metrica.total > 0);
  const promedioGeneral = conDatos.length
    ? conDatos.reduce((sum, metrica) => sum + metrica.promedio, 0) / conDatos.length
    : 0;
  const ordenadas = [...conDatos].sort((a, b) => b.promedio - a.promedio);
  const totalCalificaciones = Object.values(conteosGenerales).reduce((sum, cantidad) => sum + cantidad, 0);
  const favorables = totalCalificaciones
    ? Math.round((feedbackRatingValues
        .filter(valor => valor >= 4)
        .reduce((sum, valor) => sum + conteosGenerales[valor], 0) / totalCalificaciones) * 100)
    : 0;

  return {
    metricas,
    conteosGenerales,
    totalCalificaciones,
    favorables,
    tendencia,
    promedioGeneral,
    fortaleza: ordenadas[0]?.label || "-",
    debilidad: ordenadas[ordenadas.length - 1]?.label || "-"
  };
}

function crearSegmentosConic(conteos, total) {
  if (!total) return "#eef2f7 0 360deg";

  let inicio = 0;
  return feedbackRatingValues.map(valor => {
    const grados = (conteos[valor] / total) * 360;
    const fin = inicio + grados;
    const segmento = `${feedbackChartColors[valor]} ${inicio.toFixed(2)}deg ${fin.toFixed(2)}deg`;
    inicio = fin;
    return segmento;
  }).join(", ");
}

function renderAdminOverallChart(conteos, total, promedioGeneral) {
  const contenedor = document.getElementById("adminOverallChart");
  const segmentos = crearSegmentosConic(conteos, total);
  const leyenda = feedbackRatingValues.map(valor => {
    const porcentaje = total ? Math.round((conteos[valor] / total) * 100) : 0;
    return `
      <li>
        <span class="admin-legend-dot" style="background:${feedbackChartColors[valor]}"></span>
        <span>${renderStars(valor)}</span>
        <strong>${porcentaje}%</strong>
      </li>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="admin-donut" style="background: conic-gradient(${segmentos});">
      <div class="admin-donut-center">
        <span>Average</span>
        <strong>${promedioGeneral ? formatearRating(Number(promedioGeneral.toFixed(1))) : "-"}</strong>
      </div>
    </div>
    <ul class="admin-legend">${leyenda}</ul>`;
}

function renderAdminTrendChart(tendencia) {
  const contenedor = document.getElementById("adminTrendChart");
  if (!tendencia.length) {
    contenedor.innerHTML = '<p class="admin-empty">Not enough data to chart the trend yet.</p>';
    return;
  }

  const width = 680;
  const height = 230;
  const padding = 28;
  const puntos = tendencia.map((item, index) => {
    const x = tendencia.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (tendencia.length - 1);
    const y = padding + ((5 - item.promedio) * (height - padding * 2)) / 4;
    return { x, y, promedio: item.promedio, creadoEn: item.creadoEn };
  });
  const path = puntos.map((punto, index) => `${index ? "L" : "M"} ${punto.x.toFixed(1)} ${punto.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${puntos[puntos.length - 1].x.toFixed(1)} ${height - padding} L ${puntos[0].x.toFixed(1)} ${height - padding} Z`;
  const ultimo = puntos[puntos.length - 1];
  const etiquetaFecha = ultimo.creadoEn
    ? new Date(ultimo.creadoEn).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Latest";

  contenedor.innerHTML = `
    <svg class="admin-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Service rating trend">
      <defs>
        <linearGradient id="adminTrendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"></stop>
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="admin-axis"></line>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="admin-axis"></line>
      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" class="admin-grid-line"></line>
      <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" class="admin-grid-line"></line>
      <path d="${area}" class="admin-trend-area"></path>
      <path d="${path}" class="admin-trend-line"></path>
      ${puntos.map(punto => `<circle cx="${punto.x.toFixed(1)}" cy="${punto.y.toFixed(1)}" r="4" class="admin-trend-point"></circle>`).join("")}
      <text x="${padding - 8}" y="${padding + 4}" class="admin-axis-label">5</text>
      <text x="${padding - 8}" y="${height - padding + 4}" class="admin-axis-label">1</text>
    </svg>
    <div class="admin-trend-caption">
      <span>Latest score</span>
      <strong>${ultimo.promedio.toFixed(1)}</strong>
      <em>${escaparHTML(etiquetaFecha)}</em>
    </div>`;
}

function renderAdminCharts(metricas) {
  const contenedor = document.getElementById("adminCharts");
  contenedor.innerHTML = metricas.map(metrica => {
    const max = Math.max(metrica.total, 1);
    const filas = feedbackRatingValues.map(valor => {
      const cantidad = metrica.conteos[valor];
      const ancho = Math.round((cantidad / max) * 100);
      return `
        <div class="admin-bar-row">
          <span>${renderStars(valor)}</span>
          <div class="admin-bar-track"><span class="admin-bar-fill" style="width:${ancho}%; background:${feedbackChartColors[valor]}"></span></div>
          <strong>${ancho}%</strong>
        </div>`;
    }).join("");

    const promedio = metrica.total ? metrica.promedio.toFixed(1) : "-";
    return `
      <article class="admin-chart">
        <div class="admin-chart-head">
          <div>
            <span class="admin-panel-label">Question</span>
            <h4>${metrica.label}</h4>
          </div>
          <strong>${promedio}</strong>
        </div>
        <p class="admin-chart-meta">${metrica.total} recorded responses</p>
        ${filas}
      </article>`;
  }).join("");
}

function renderAdminComentarios(feedback) {
  const contenedor = document.getElementById("adminComentarios");
  const comentarios = feedback
    .filter(item => String(item.comentario || "").trim())
    .sort((a, b) => new Date(b.creadoEn || 0) - new Date(a.creadoEn || 0))
    .slice(0, 8);

  if (!comentarios.length) {
    contenedor.innerHTML = '<p class="admin-empty">No comments have been recorded yet.</p>';
    return;
  }

  contenedor.innerHTML = comentarios.map(item => {
    const fecha = item.creadoEn
      ? new Date(item.creadoEn).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "No date";
    return `
      <article class="admin-comment">
        <p>${escaparHTML(item.comentario)}</p>
        <time>${escaparHTML(fecha)}</time>
      </article>`;
  }).join("");
}

async function renderPanelFeedback() {
  const status = document.getElementById("adminStatus");
  status.textContent = "Loading feedback...";

  const data = await obtenerFeedbackAdmin();
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  const feedback = Array.isArray(data) ? data : [];
  const {
    metricas,
    conteosGenerales,
    totalCalificaciones,
    favorables,
    tendencia,
    promedioGeneral,
    debilidad
  } = calcularMetricasFeedback(feedback);

  document.getElementById("adminTotalFeedback").textContent = feedback.length;
  document.getElementById("adminPromedioGeneral").textContent = promedioGeneral ? promedioGeneral.toFixed(1) : "-";
  document.getElementById("adminFortaleza").textContent = feedback.length ? `${favorables}%` : "-";
  document.getElementById("adminDebilidad").textContent = debilidad;

  renderAdminOverallChart(conteosGenerales, totalCalificaciones, promedioGeneral);
  renderAdminTrendChart(tendencia);
  renderAdminCharts(metricas);
  renderAdminComentarios(feedback);
  status.textContent = feedback.length ? "Feedback updated." : "No feedback responses yet.";
}

// =======================
// FEEDBACK
// =======================
function setFeedbackAbierto(abierto) {
  const panel = document.getElementById("feedbackPanel");
  const toggle = document.getElementById("btnFeedbackToggle");
  panel.style.display = abierto ? "block" : "none";
  toggle.setAttribute("aria-expanded", abierto ? "true" : "false");
}

function actualizarStarRating(widget, valorSeleccionado) {
  const valor = normalizarFeedbackValor(valorSeleccionado) || 0;
  widget.querySelectorAll(".star-button").forEach(button => {
    const estrella = parseInt(button.dataset.star, 10);
    button.classList.toggle("is-filled", valor >= estrella);
    button.classList.toggle("is-half", valor === estrella - 0.5);
    button.setAttribute("aria-checked", String(valor === estrella || valor === estrella - 0.5));
  });

  const valueLabel = widget.querySelector(".star-rating-value");
  valueLabel.textContent = valor ? `${formatearRating(valor)} / 5` : "Not rated";
}

function seleccionarStarRating(widget, event, estrella) {
  const target = document.getElementById(widget.dataset.ratingTarget);
  const rect = event.currentTarget.getBoundingClientRect();
  const mitadIzquierda = event.clientX - rect.left < rect.width / 2;
  const valor = estrella === 1 && mitadIzquierda ? 1 : estrella - (mitadIzquierda ? 0.5 : 0);
  target.value = formatearRating(valor);
  actualizarStarRating(widget, valor);
}

function inicializarStarRatings() {
  document.querySelectorAll(".star-rating-input").forEach(widget => {
    const target = document.getElementById(widget.dataset.ratingTarget);
    widget.innerHTML = "";

    for (let estrella = 1; estrella <= 5; estrella += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "star-button";
      button.dataset.star = String(estrella);
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${estrella} stars`);
      button.setAttribute("aria-checked", "false");
      button.addEventListener("click", event => seleccionarStarRating(widget, event, estrella));
      widget.appendChild(button);
    }

    const valueLabel = document.createElement("span");
    valueLabel.className = "star-rating-value";
    widget.appendChild(valueLabel);
    actualizarStarRating(widget, target.value);
  });
}

function limpiarFeedback() {
  ["feedbackWifi", "feedbackColaboradores", "feedbackDispositivos"].forEach(id => {
    document.getElementById(id).value = "";
    const widget = document.querySelector(`.star-rating-input[data-rating-target="${id}"]`);
    if (widget) actualizarStarRating(widget, "");
  });
  document.getElementById("feedbackComentario").value = "";
  document.getElementById("feedbackStatus").textContent = "";
}

async function enviarFeedback(event) {
  event.preventDefault();

  const status = document.getElementById("feedbackStatus");
  const boton = document.getElementById("btnFeedbackEnviar");
  const payload = {
    wifi: document.getElementById("feedbackWifi").value,
    colaboradores: document.getElementById("feedbackColaboradores").value,
    dispositivos: document.getElementById("feedbackDispositivos").value,
    comentario: document.getElementById("feedbackComentario").value.trim()
  };

  status.textContent = "Enviando...";
  boton.disabled = true;

  const data = await enviarFeedbackAPI(payload);
  boton.disabled = false;

  if (data.error) {
    status.textContent = data.error;
    return;
  }

  limpiarFeedback();
  status.textContent = "Gracias por su calificacion.";
  setTimeout(() => {
    setFeedbackAbierto(false);
    status.textContent = "";
  }, 1200);
}

// =======================
// EVENTOS
// =======================
inicializarStarRatings();

document.getElementById("btnCerrarModal").addEventListener("click", cerrarModal);
document.getElementById("btnCancelarModal").addEventListener("click", cerrarModal);
document.getElementById("btnConfirmarReserva").addEventListener("click", confirmarReserva);
document.getElementById("btnAceptarResponsabilidad").addEventListener("click", aceptarResponsabilidad);
document.getElementById("btnCancelarResponsabilidad").addEventListener("click", cancelarResponsabilidad);
document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modalOverlay")) cerrarModal();
});
document.getElementById("btnAdmin").addEventListener("click", loginAdmin);
document.getElementById("btnPanelAdmin").addEventListener("click", abrirPanelAdmin);
document.getElementById("btnSolicitudesRecientes").addEventListener("click", abrirSolicitudesRecientes);
document.getElementById("btnLogout").addEventListener("click", logout);
document.getElementById("btnCerrarConfirmacionAdmin").addEventListener("click", cerrarConfirmacionAdmin);
document.getElementById("btnCancelarConfirmacionAdmin").addEventListener("click", cerrarConfirmacionAdmin);
document.getElementById("btnAceptarConfirmacionAdmin").addEventListener("click", aceptarConfirmacionAdmin);
document.getElementById("confirmacionAdminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("confirmacionAdminOverlay")) cerrarConfirmacionAdmin();
});
document.getElementById("btnCerrarLimiteSolicitudes").addEventListener("click", cerrarLimiteSolicitudes);
document.getElementById("limiteSolicitudesOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("limiteSolicitudesOverlay")) cerrarLimiteSolicitudes();
});
document.getElementById("btnDisminuirLimite").addEventListener("click", () => ajustarInputLimite(-1));
document.getElementById("btnAumentarLimite").addEventListener("click", () => ajustarInputLimite(1));
document.getElementById("btnGuardarLimiteDia").addEventListener("click", guardarLimiteDiaDesdeModal);
document.getElementById("btnRestablecerLimiteDia").addEventListener("click", restablecerLimiteDiaDesdeModal);
document.getElementById("btnCerrarReservaAdmin").addEventListener("click", cerrarReservaAdmin);
document.getElementById("btnCancelarReservaAdmin").addEventListener("click", cerrarReservaAdmin);
document.getElementById("btnBloquearReservaAdmin").addEventListener("click", bloquearReservaDesdeModal);
document.getElementById("reservaAdminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("reservaAdminOverlay")) cerrarReservaAdmin();
});
document.getElementById("btnCerrarPanelAdmin").addEventListener("click", cerrarPanelAdmin);
document.getElementById("adminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("adminOverlay")) cerrarPanelAdmin();
});
document.getElementById("btnRefrescarFeedback").addEventListener("click", renderPanelFeedback);
document.getElementById("btnCerrarSolicitudesRecientes").addEventListener("click", cerrarSolicitudesRecientes);
document.getElementById("recentRequestsOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("recentRequestsOverlay")) cerrarSolicitudesRecientes();
});
document.getElementById("btnRefrescarSolicitudesRecientes").addEventListener("click", renderSolicitudesRecientes);
document.getElementById("btnFeedbackToggle").addEventListener("click", () => {
  const abierto = document.getElementById("feedbackPanel").style.display !== "none";
  setFeedbackAbierto(!abierto);
});
document.getElementById("btnFeedbackCerrar").addEventListener("click", () => setFeedbackAbierto(false));
document.getElementById("btnFeedbackCancelar").addEventListener("click", () => {
  limpiarFeedback();
  setFeedbackAbierto(false);
});
document.getElementById("feedbackPanel").addEventListener("submit", enviarFeedback);
document.getElementById("miniMonthButton").addEventListener("click", event => {
  event.stopPropagation();
  const menu = document.getElementById("miniMonthMenu");
  const button = document.getElementById("miniMonthButton");
  const abierto = menu.classList.toggle("open");
  button.setAttribute("aria-expanded", String(abierto));
});
document.getElementById("miniMonthOptions").addEventListener("click", event => {
  const option = event.target.closest(".mini-month-option");
  if (!option) return;
  fechaActual = obtenerFechaInicialMes(fechaActual.getFullYear(), parseInt(option.dataset.month, 10));
  document.getElementById("miniMonthMenu").classList.remove("open");
  document.getElementById("miniMonthButton").setAttribute("aria-expanded", "false");
  renderMiniCalendar();
  renderSemana();
});
document.addEventListener("click", event => {
  const menu = document.getElementById("miniMonthMenu");
  if (!menu || menu.contains(event.target)) return;
  menu.classList.remove("open");
  document.getElementById("miniMonthButton").setAttribute("aria-expanded", "false");
});

// =======================
// INIT
// =======================
(async () => {
  const monthOptions = document.getElementById("miniMonthOptions");
  monthOptions.innerHTML = mesesMini.map((mes, index) =>
    `<button class="mini-month-option" type="button" role="option" data-month="${index}">${mes}</button>`
  ).join("");
  await verificarBackend();
  await obtenerConfig();
  actualizarBotonesAdmin();
  renderMiniCalendar();
  await renderSemana();
})();
