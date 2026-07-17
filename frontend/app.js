function obtenerAPIBase() {
  const apiConfigurada = window.API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content;
  if (apiConfigurada) return String(apiConfigurada).replace(/\/$/, "");

  const hostLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  if (hostLocal && window.location.port !== "3000") return "http://localhost:3000";

  return window.location.origin;
}

const API = obtenerAPIBase();
const permiteFallbackLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
const DIAS_ANTELACION_RESERVA = 2;

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
let adminAnalyticsTab = "feedback";

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
const seccionPlaceholder = "Seleccione una sección";
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
  const inicioSemana = obtenerInicioSemana(hoy);
  const inicio = new Date(hoy);
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() + DIAS_ANTELACION_RESERVA);

  const fin = new Date(inicioSemana);
  fin.setDate(inicioSemana.getDate() + 13);
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

function normalizarReserva(reserva) {
  if (!reserva || typeof reserva !== "object") return reserva;

  const asignatura = String(reserva.asignatura || reserva.materia || reserva.subject || reserva.area || "").trim();
  const objetivoUso = String(reserva.objetivoUso || reserva.nota || "").trim();

  if (asignatura) {
    reserva.asignatura = asignatura;
    reserva.materia = asignatura;
    reserva.subject = asignatura;
  }

  if (objetivoUso) {
    reserva.objetivoUso = objetivoUso;
    reserva.nota = objetivoUso;
  }

  return reserva;
}

function normalizarReservas(reservas) {
  return Array.isArray(reservas) ? reservas.map(normalizarReserva) : [];
}

// =======================
// STORAGE LOCAL
// =======================
function leerReservasLocal() {
  try { return normalizarReservas(JSON.parse(localStorage.getItem("reservas") || "[]")); } catch { return []; }
}
function guardarReservasLocal(r) { localStorage.setItem("reservas", JSON.stringify(normalizarReservas(r))); }
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
        const reservasNormalizadas = normalizarReservas(data);
        guardarReservasLocal(reservasNormalizadas);
        return reservasNormalizadas;
      }
    } catch {}
  }
  if (!permiteFallbackLocal) return [];
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
  if (!backendDisponible && !permiteFallbackLocal) {
    return { error: "No se pudo conectar con el servidor. Intenta de nuevo." };
  }

  const reservas = leerReservasLocal();
  if (esFestivoColombia(payload.fecha)) return { error: "No se pueden hacer solicitudes en festivos." };
  const limiteHorario = validarLimiteSolicitudesHorario(reservas, payload.fecha, payload.hour);
  if (limiteHorario.error) return { error: limiteHorario.error };
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === payload.fecha && (b.hour === payload.hour || b.hour === null)))
    return { error: "Este horario está bloqueado 🚫" };
  const capacidad = validarCapacidadHorario(reservas, payload.fecha, payload.hour, payload.cantidad);
  if (capacidad.error) return { error: capacidad.error };

  let nueva = normalizarReserva({
    id: Date.now(),
    creadoEn: new Date().toISOString(),
    ...payload,
    cantidad: capacidad.cantidadSolicitada,
    estado: "aprobado"
  });

  if (backendDisponible) {
    try {
      const res = await fetch(`${API}/reservas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token || "" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) return data;
      nueva = normalizarReserva(data.reserva || nueva);
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo guardar la solicitud porque el servidor no respondió." };
      }
    }
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
  if (!backendDisponible && !permiteFallbackLocal) {
    return { error: "No se pudo conectar con el servidor. Intenta de nuevo." };
  }

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
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo validar la solicitud porque el servidor no respondió." };
      }
    }
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
  if (!backendDisponible && !permiteFallbackLocal) {
    return { error: "No se pudo conectar con el servidor. Intenta de nuevo." };
  }

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
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo guardar la calificacion porque el servidor no respondió." };
      }
    }
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
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo cargar el feedback porque el servidor no respondió." };
      }
    }
  }

  if (!permiteFallbackLocal) return { error: "No se pudo conectar con el servidor para cargar el feedback." };
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
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo guardar el limite porque el servidor no respondió." };
      }
    }
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
    } catch {
      if (!permiteFallbackLocal) {
        return { error: "No se pudo validar la solicitud porque el servidor no respondió." };
      }
    }
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

function cerrarMenuAdminMovil() {
  const panel = document.querySelector(".admin-panel");
  const session = document.querySelector(".sidebar-session");
  const toggle = document.getElementById("btnAdminMenu");
  if (!panel || !toggle) return;

  panel.classList.remove("menu-open");
  session?.classList.remove("admin-menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

function alternarMenuAdminMovil() {
  const panel = document.querySelector(".admin-panel");
  const session = document.querySelector(".sidebar-session");
  const toggle = document.getElementById("btnAdminMenu");
  if (!panel || !toggle) return;

  const abierto = panel.classList.toggle("menu-open");
  session?.classList.toggle("admin-menu-open", abierto);
  toggle.setAttribute("aria-expanded", String(abierto));
}

function logout() {
  token = null; rol = "profesor"; usuarioSesion = ""; modoAdmin = false;
  localStorage.removeItem("token");
  localStorage.removeItem("rol");
  localStorage.removeItem("usuarioSesion");
  localStorage.removeItem("modoAdmin");
  actualizarBotonesAdmin();
  cerrarMenuAdminMovil();
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
  document.getElementById("btnAdminMenu").hidden = !sesionActiva;
  if (!sesionActiva) cerrarMenuAdminMovil();
  sessionUserBadge.style.display = sesionActiva ? "block" : "none";
  sessionUserBadge.textContent = (usuarioSesion || rol).toUpperCase();
}

function actualizarIndicadorScrollSolicitud() {
  const modal = document.getElementById("modalSolicitud");
  const hint = document.getElementById("modalSolicitudScrollHint");
  if (!modal || !hint || document.getElementById("modalOverlay").style.display === "none") return;

  const hayContenidoAbajo = modal.scrollTop + modal.clientHeight < modal.scrollHeight - 8;
  hint.classList.toggle("visible", hayContenidoAbajo);
}

function setSeccionSeleccionada(valor) {
  const input = document.getElementById("inputSeccion");
  const label = document.getElementById("seccionSelectLabel");
  const opciones = document.querySelectorAll("#seccionSelectOptions .custom-select-option");

  input.value = valor;
  label.textContent = valor || seccionPlaceholder;
  opciones.forEach(opcion => {
    const seleccionada = opcion.dataset.value === valor;
    opcion.classList.toggle("selected", seleccionada);
    opcion.setAttribute("aria-selected", String(seleccionada));
  });
}

function cerrarSeccionSelect() {
  const select = document.getElementById("seccionSelect");
  const boton = document.getElementById("seccionSelectButton");
  if (!select || !boton) return;
  select.classList.remove("open");
  boton.setAttribute("aria-expanded", "false");
}

function alternarSeccionSelect(event) {
  event.stopPropagation();
  const select = document.getElementById("seccionSelect");
  const boton = document.getElementById("seccionSelectButton");
  const abierto = select.classList.toggle("open");
  boton.setAttribute("aria-expanded", String(abierto));
  actualizarIndicadorScrollSolicitud();
}

function seleccionarSeccionDesdeOpcion(opcion) {
  setSeccionSeleccionada(opcion.dataset.value || "");
  cerrarSeccionSelect();
  actualizarIndicadorScrollSolicitud();
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
  ["inputNombre", "inputCantidad", "inputCurso", "inputAplicacion", "inputSeccion", "inputAsignatura", "inputCorreo", "inputObjetivoUso"].forEach(id => {
    document.getElementById(id).value = "";
  });
  setSeccionSeleccionada("");
  cerrarSeccionSelect();
  document.getElementById("solicitudStatus").textContent = "";
  document.getElementById("modalOverlay").style.display = "flex";
  requestAnimationFrame(actualizarIndicadorScrollSolicitud);
}

function cerrarModal() {
  document.getElementById("modalOverlay").style.display = "none";
  document.getElementById("modalSolicitudScrollHint").classList.remove("visible");
  cerrarSeccionSelect();
  pendingFecha = pendingHour = pendingReservaPayload = null;
}

function mostrarErrorSolicitud(mensaje, inputId = null) {
  document.getElementById("solicitudStatus").textContent = mensaje;
  if (!inputId) return;
  if (inputId === "inputSeccion") {
    document.getElementById("seccionSelectButton").focus();
    return;
  }
  document.getElementById(inputId).focus();
}

function esErrorLimiteSolicitudes(mensaje) {
  return String(mensaje || "").includes("alcanzó el límite");
}

async function confirmarReserva() {
  const nombre   = document.getElementById("inputNombre").value.trim();
  const cantidad = document.getElementById("inputCantidad").value.trim();
  const curso    = document.getElementById("inputCurso").value.trim();
  const aplicacion = document.getElementById("inputAplicacion").value.trim();
  const seccion  = document.getElementById("inputSeccion").value.trim();
  const asignatura = document.getElementById("inputAsignatura").value.trim();
  const correo   = document.getElementById("inputCorreo").value.trim();
  const objetivoUso = document.getElementById("inputObjetivoUso").value.trim();

  document.getElementById("solicitudStatus").textContent = "";

  if (!nombre) { mostrarErrorSolicitud("El nombre es obligatorio.", "inputNombre"); return; }
  if (!cantidad || isNaN(cantidad) || parseInt(cantidad) <= 0) {
    mostrarErrorSolicitud("Ingresa una cantidad valida.", "inputCantidad");
    return;
  }
  if (!curso) { mostrarErrorSolicitud("El curso o lugar es obligatorio.", "inputCurso"); return; }
  if (!seccion) { mostrarErrorSolicitud("La sección es obligatoria.", "inputSeccion"); return; }
  if (!asignatura) { mostrarErrorSolicitud("La asignatura es obligatoria.", "inputAsignatura"); return; }
  if (!correoInstitucionalValido(correo)) {
    mostrarErrorSolicitud("Ingresa un correo valido con dominio @colamericano.edu.co.", "inputCorreo");
    return;
  }
  if (!objetivoUso) { mostrarErrorSolicitud("El objetivo de uso es obligatorio.", "inputObjetivoUso"); return; }

  const payload = {
    clientRequestId: window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fecha: pendingFecha, hour: pendingHour,
    usuario: nombre,
    equipo: `${cantidad} iPads · ${curso}`,
    curso,
    aplicacion,
    seccion,
    asignatura,
    materia: asignatura,
    subject: asignatura,
    cantidad: parseInt(cantidad),
    correo,
    objetivoUso,
    nota: objetivoUso
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

function obtenerSeccionReserva(reserva) {
  if (reserva.seccion) return reserva.seccion;

  const curso = String(reserva.curso || "").trim();
  const grado = parseInt(curso.length >= 3 ? curso.slice(0, -2) : curso, 10);
  if (!Number.isInteger(grado)) return "";
  if (grado <= 1) return "Sección Preescolar y 1º";
  if (grado <= 6) return "Sección Primaria y 6º";
  return "Sección Secundaria y Media";
}

function obtenerAsignaturaReserva(reserva) {
  return String(normalizarReserva(reserva)?.asignatura || "").trim();
}

function obtenerObjetivoUsoReserva(reserva) {
  return String(normalizarReserva(reserva)?.objetivoUso || "").trim();
}

function renderReservasHorario(reservasHorario) {
  if (!reservasHorario.length) return "";

  return reservasHorario.map(reserva => {
    const seccion = obtenerSeccionReserva(reserva);
    const asignatura = obtenerAsignaturaReserva(reserva);
    const detalleIpads = modoAdmin
      ? `<span class="cell-reserva-ipads">${escaparHTML(reserva.cantidad || "0")} iPads</span>`
      : "";
    const detalleAdmin = modoAdmin && (seccion || asignatura)
      ? `<span class="cell-reserva-admin-meta">${escaparHTML([seccion, asignatura].filter(Boolean).join(" · "))}</span>`
      : "";
    return `
      <span class="cell-reserva-item">
        <span class="cell-reserva-persona">${escaparHTML(reserva.usuario)}${reserva.curso ? ` - ${escaparHTML(reserva.curso)}` : ""}</span>
        ${detalleAdmin}
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

  lista.innerHTML = pendingAdminReservasHorario.map(reserva => {
    const seccion = obtenerSeccionReserva(reserva);
    const asignatura = obtenerAsignaturaReserva(reserva);
    const objetivoUso = obtenerObjetivoUsoReserva(reserva);

    return `
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
          <span class="reserva-admin-label">Curso/Lugar</span>
          <p>${escaparHTML(reserva.curso || "Sin curso o lugar")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Aplicación que requiere</span>
          <p>${escaparHTML(reserva.aplicacion || "No registrada")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Sección</span>
          <p>${escaparHTML(seccion || "No registrada")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Asignatura</span>
          <p>${escaparHTML(asignatura || "No registrada")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Cantidad de iPads</span>
          <p>${escaparHTML(reserva.cantidad || "Sin cantidad")}</p>
        </div>
        <div>
          <span class="reserva-admin-label">Correo electrónico</span>
          <p>${escaparHTML(reserva.correo || "No registrado")}</p>
        </div>
        <div class="reserva-admin-note">
          <span class="reserva-admin-label">Objetivo de uso</span>
          <p>${escaparHTML(objetivoUso || "Sin objetivo de uso")}</p>
        </div>
      </div>
    </article>
  `;
  }).join("");

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
  {
    key: "eficienciaPrestamo",
    label: "Eficiencia del préstamo",
    question: "¿El proceso de préstamo de iPads es eficiente y contribuye al desarrollo de las actividades pedagógicas?"
  },
  {
    key: "colaboradores",
    label: "Servicio de colaboradores",
    question: "¿Cómo califica el servicio recibido por nuestros colaboradores?"
  },
  {
    key: "configuracionIpads",
    label: "Configuración y condición de iPads",
    question: "¿Las iPads se entregaron configuradas, en condiciones adecuadas de funcionamiento y satisfacen las necesidades para el desarrollo de las actividades y plataformas educativas?"
  }
];

const feedbackRatingValues = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

const feedbackChartColors = {
  5: "#7c3aed",
  4.5: "#38bdf8",
  4: "#2563eb",
  3.5: "#f97316",
  3: "#ef4444",
  2.5: "#f59e0b",
  2: "#fb7185",
  1.5: "#a855f7",
  1: "#dc2626"
};
const requestChartColors = ["#f97316", "#ef4444", "#7c3aed", "#38bdf8", "#2563eb", "#a855f7", "#fb7185", "#475467"];

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
  await cambiarAdminAnalyticsTab(adminAnalyticsTab);
}

async function cambiarAdminAnalyticsTab(tab) {
  adminAnalyticsTab = tab === "requests" ? "requests" : "feedback";
  const esFeedback = adminAnalyticsTab === "feedback";

  document.getElementById("adminFeedbackView").classList.toggle("active", esFeedback);
  document.getElementById("adminRequestsView").classList.toggle("active", !esFeedback);
  document.getElementById("adminTabFeedback").classList.toggle("active", esFeedback);
  document.getElementById("adminTabRequests").classList.toggle("active", !esFeedback);
  document.getElementById("adminTabFeedback").setAttribute("aria-selected", String(esFeedback));
  document.getElementById("adminTabRequests").setAttribute("aria-selected", String(!esFeedback));

  if (esFeedback) await renderPanelFeedback();
  else await renderRequestsAnalytics();
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
  const seccion = obtenerSeccionReserva(reserva);
  const asignatura = obtenerAsignaturaReserva(reserva);
  const objetivoUso = obtenerObjetivoUsoReserva(reserva);
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
        ${seccion ? `<span>${escaparHTML(seccion)}</span>` : ""}
        <span class="recent-request-subject">Asignatura: ${escaparHTML(asignatura || "No registrada")}</span>
      </div>
      ${objetivoUso ? `<p class="recent-request-note">${escaparHTML(objetivoUso)}</p>` : ""}
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
          <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.32"></stop>
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
    const correo = String(item.correo || "").trim();
    return `
      <article class="admin-comment">
        <p>${escaparHTML(item.comentario)}</p>
        <time>${escaparHTML(correo ? `${correo} · ${fecha}` : fecha)}</time>
      </article>`;
  }).join("");
}

function renderFeedbackHistorial(feedback) {
  const contenedor = document.getElementById("adminFeedbackHistorial");
  const items = [...feedback]
    .sort((a, b) => new Date(b.creadoEn || 0) - new Date(a.creadoEn || 0));

  if (!items.length) {
    contenedor.innerHTML = '<p class="admin-empty">No feedback has been recorded yet.</p>';
    return;
  }

  contenedor.innerHTML = items.map(item => {
    const correo = String(item.correo || "").trim() || "Correo no registrado";
    const fecha = item.creadoEn
      ? new Date(item.creadoEn).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
      : "Fecha no disponible";
    const comentario = String(item.comentario || "").trim();
    const respuestas = feedbackPreguntas.map(pregunta => {
      const valor = normalizarFeedbackValor(item[pregunta.key]);
      return `
        <div class="feedback-history-answer">
          <span>${escaparHTML(pregunta.question)}</span>
          <strong>${valor === null ? "Sin calificación" : renderStars(valor)}</strong>
        </div>`;
    }).join("");

    return `
      <article class="feedback-history-item">
        <header class="feedback-history-head">
          <div>
            <strong>${escaparHTML(correo)}</strong>
            <time>${escaparHTML(fecha)}</time>
          </div>
        </header>
        <div class="feedback-history-answers">${respuestas}</div>
        ${comentario ? `<p class="feedback-history-comment">${escaparHTML(comentario)}</p>` : ""}
      </article>`;
  }).join("");
}

function agregarTotalPorClave(mapa, clave, cantidad) {
  const nombre = String(clave || "Not registered").trim() || "Not registered";
  mapa.set(nombre, (mapa.get(nombre) || 0) + cantidad);
}

function obtenerTopCategoria(items) {
  return items.length ? items[0].label : "-";
}

function crearDatosPieDesdeMapa(mapa) {
  return [...mapa.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function renderRequestsPieChart(contenedorId, datos, total, etiquetaCentral) {
  const contenedor = document.getElementById(contenedorId);
  if (!datos.length || !total) {
    contenedor.innerHTML = '<p class="admin-empty">Not enough request data to chart yet.</p>';
    return;
  }

  let inicio = 0;
  const segmentos = datos.map((item, index) => {
    const grados = (item.value / total) * 360;
    const fin = inicio + grados;
    const color = requestChartColors[index % requestChartColors.length];
    const segmento = `${color} ${inicio.toFixed(2)}deg ${fin.toFixed(2)}deg`;
    inicio = fin;
    return segmento;
  }).join(", ");

  const leyenda = datos.map((item, index) => {
    const color = requestChartColors[index % requestChartColors.length];
    const porcentaje = Math.round((item.value / total) * 100);
    return `
      <li>
        <span class="admin-legend-dot" style="background:${color}"></span>
        <span>${escaparHTML(item.label)}</span>
        <strong>${item.value} · ${porcentaje}%</strong>
      </li>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="requests-donut" style="background: conic-gradient(${segmentos});">
      <div class="requests-donut-center">
        <span>${escaparHTML(etiquetaCentral)}</span>
        <strong>${total}</strong>
      </div>
    </div>
    <ul class="admin-legend requests-legend">${leyenda}</ul>`;
}

function obtenerMesCreacionSolicitud(reserva) {
  const fecha = new Date(reserva.creadoEn || reserva.fecha || "");
  if (Number.isNaN(fecha.getTime())) return null;

  return {
    key: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`,
    label: fecha.toLocaleDateString("en-US", { month: "short", year: "numeric" })
  };
}

function crearDatosSolicitudesMensuales(solicitudes) {
  const meses = new Map();
  solicitudes.forEach(reserva => {
    const mes = obtenerMesCreacionSolicitud(reserva);
    if (!mes) return;

    const actual = meses.get(mes.key) || { ...mes, value: 0 };
    actual.value += 1;
    meses.set(mes.key, actual);
  });

  return [...meses.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function renderRequestsMonthlyChart(datos) {
  const contenedor = document.getElementById("requestsMensualesChart");
  if (!datos.length) {
    contenedor.innerHTML = '<p class="admin-empty">Not enough request data to chart yet.</p>';
    return;
  }

  const max = Math.max(...datos.map(item => item.value), 1);
  contenedor.innerHTML = datos.map(item => {
    const alto = Math.max(8, Math.round((item.value / max) * 100));
    return `
      <div class="requests-month-bar" style="--bar-height:${alto}%">
        <strong>${item.value}</strong>
        <span class="requests-month-column" aria-hidden="true"></span>
        <em>${escaparHTML(item.label)}</em>
      </div>`;
  }).join("");
}

async function renderRequestsAnalytics() {
  const status = document.getElementById("adminStatus");
  status.textContent = "Loading request analytics...";

  const data = await obtenerReservas();
  const solicitudes = Array.isArray(data)
    ? data.filter(reserva => String(reserva.estado || "aprobado").toLowerCase() !== "rechazado")
    : [];

  const porSeccion = new Map();
  const porAsignatura = new Map();
  let totalIpads = 0;

  solicitudes.forEach(reserva => {
    const cantidad = parseInt(reserva.cantidad, 10) || 0;
    totalIpads += cantidad;
    agregarTotalPorClave(porSeccion, obtenerSeccionReserva(reserva), cantidad);
    agregarTotalPorClave(porAsignatura, obtenerAsignaturaReserva(reserva), cantidad);
  });

  const datosSeccion = crearDatosPieDesdeMapa(porSeccion);
  const datosAsignatura = crearDatosPieDesdeMapa(porAsignatura);
  const datosMensuales = crearDatosSolicitudesMensuales(solicitudes);

  document.getElementById("requestsTotalSolicitudes").textContent = solicitudes.length;
  document.getElementById("requestsTotalIpads").textContent = totalIpads;
  document.getElementById("requestsTopSeccion").textContent = obtenerTopCategoria(datosSeccion);
  document.getElementById("requestsTopAsignatura").textContent = obtenerTopCategoria(datosAsignatura);

  renderRequestsPieChart("requestsSeccionChart", datosSeccion, totalIpads, "iPads");
  renderRequestsPieChart("requestsAsignaturaChart", datosAsignatura, totalIpads, "iPads");
  renderRequestsMonthlyChart(datosMensuales);
  status.textContent = solicitudes.length ? "Request analytics updated." : "No request data yet.";
}

function excelValor(valor) {
  return escaparHTML(valor === null || valor === undefined ? "" : valor);
}

function tablaExcel(titulo, encabezados, filas) {
  return `
    <h2>${excelValor(titulo)}</h2>
    <table>
      <thead><tr>${encabezados.map(item => `<th>${excelValor(item)}</th>`).join("")}</tr></thead>
      <tbody>
        ${filas.length
          ? filas.map(fila => `<tr>${fila.map(valor => `<td>${excelValor(valor)}</td>`).join("")}</tr>`).join("")
          : `<tr><td colspan="${encabezados.length}">No data</td></tr>`}
      </tbody>
    </table>`;
}

function puntoPolar(cx, cy, radio, angulo) {
  const radianes = (angulo - 90) * Math.PI / 180;
  return {
    x: cx + radio * Math.cos(radianes),
    y: cy + radio * Math.sin(radianes)
  };
}

function arcoSvg(cx, cy, radio, inicio, fin) {
  const start = puntoPolar(cx, cy, radio, fin);
  const end = puntoPolar(cx, cy, radio, inicio);
  const arcoGrande = fin - inicio <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radio} ${radio} 0 ${arcoGrande} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function graficaPieExcel(titulo, datos, total, colores) {
  if (!datos.length || !total) return `<h2>${excelValor(titulo)}</h2><p>No data</p>`;

  let inicio = 0;
  const segmentos = datos.map((item, index) => {
    const grados = (item.value / total) * 360;
    const fin = inicio + grados;
    const color = colores[index % colores.length];
    const path = grados >= 359.9
      ? `<circle cx="125" cy="125" r="92" fill="${color}"></circle>`
      : `<path d="${arcoSvg(125, 125, 92, inicio, fin)}" fill="${color}"></path>`;
    inicio = fin;
    return path;
  }).join("");

  const leyenda = datos.map((item, index) => {
    const color = colores[index % colores.length];
    const porcentaje = Math.round((item.value / total) * 100);
    return `<tr><td style="background:${color};width:18px;"></td><td>${excelValor(item.label)}</td><td>${item.value}</td><td>${porcentaje}%</td></tr>`;
  }).join("");

  return `
    <h2>${excelValor(titulo)}</h2>
    <svg width="520" height="270" viewBox="0 0 520 270" xmlns="http://www.w3.org/2000/svg">
      ${segmentos}
      <circle cx="125" cy="125" r="52" fill="#ffffff"></circle>
      <text x="125" y="121" text-anchor="middle" font-family="Arial" font-size="13" fill="#667085">Total</text>
      <text x="125" y="148" text-anchor="middle" font-family="Arial" font-size="26" font-weight="700" fill="#1C4169">${total}</text>
    </svg>
    <table><tbody>${leyenda}</tbody></table>`;
}

function graficaBarrasExcel(titulo, datos, color = "#1C4169") {
  if (!datos.length) return `<h2>${excelValor(titulo)}</h2><p>No data</p>`;

  const width = Math.max(520, datos.length * 78);
  const height = 280;
  const base = 220;
  const max = Math.max(...datos.map(item => item.value), 1);
  const barras = datos.map((item, index) => {
    const barHeight = Math.max(4, (item.value / max) * 160);
    const x = 42 + index * 74;
    const y = base - barHeight;
    return `
      <rect x="${x}" y="${y.toFixed(2)}" width="36" height="${barHeight.toFixed(2)}" fill="${color}" rx="5"></rect>
      <text x="${x + 18}" y="${y - 8}" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#1C4169">${item.value}</text>
      <text x="${x + 18}" y="${base + 24}" text-anchor="middle" font-family="Arial" font-size="11" fill="#667085">${excelValor(item.label)}</text>`;
  }).join("");

  return `
    <h2>${excelValor(titulo)}</h2>
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <line x1="28" y1="${base}" x2="${width - 20}" y2="${base}" stroke="#d8e1ee" stroke-width="2"></line>
      ${barras}
    </svg>`;
}

function graficaLineaFeedbackExcel(tendencia) {
  if (!tendencia.length) return "<h2>Feedback trend</h2><p>No data</p>";

  const width = 620;
  const height = 250;
  const padding = 34;
  const puntos = tendencia.map((item, index) => {
    const x = tendencia.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (tendencia.length - 1);
    const y = padding + ((5 - item.promedio) * (height - padding * 2)) / 4;
    return { x, y, ...item };
  });
  const path = puntos.map((punto, index) => `${index ? "L" : "M"} ${punto.x.toFixed(1)} ${punto.y.toFixed(1)}`).join(" ");
  const circles = puntos.map(punto => `<circle cx="${punto.x.toFixed(1)}" cy="${punto.y.toFixed(1)}" r="4" fill="#ffffff" stroke="#0ea5e9" stroke-width="3"></circle>`).join("");

  return `
    <h2>Feedback trend</h2>
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#cfd8e6" stroke-width="2"></line>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cfd8e6" stroke-width="2"></line>
      <path d="${path}" fill="none" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      ${circles}
      <text x="${padding - 10}" y="${padding + 4}" text-anchor="end" font-family="Arial" font-size="12" fill="#667085">5</text>
      <text x="${padding - 10}" y="${height - padding + 4}" text-anchor="end" font-family="Arial" font-size="12" fill="#667085">1</text>
    </svg>`;
}

async function exportarAnalyticsExcel() {
  if (!modoAdmin) return;
  const status = document.getElementById("adminStatus");
  status.textContent = "Preparing Excel export...";

  const [feedbackData, reservasData] = await Promise.all([obtenerFeedbackAdmin(), obtenerReservas()]);
  if (feedbackData.error) { status.textContent = feedbackData.error; return; }

  const feedback = Array.isArray(feedbackData) ? feedbackData : [];
  const reservas = Array.isArray(reservasData) ? reservasData : [];
  const solicitudes = reservas.filter(reserva => String(reserva.estado || "aprobado").toLowerCase() !== "rechazado");
  const metricasFeedback = calcularMetricasFeedback(feedback);

  const porSeccion = new Map();
  const porAsignatura = new Map();
  let totalIpads = 0;
  solicitudes.forEach(reserva => {
    const cantidad = parseInt(reserva.cantidad, 10) || 0;
    totalIpads += cantidad;
    agregarTotalPorClave(porSeccion, obtenerSeccionReserva(reserva), cantidad);
    agregarTotalPorClave(porAsignatura, obtenerAsignaturaReserva(reserva), cantidad);
  });
  const datosSeccion = crearDatosPieDesdeMapa(porSeccion);
  const datosAsignatura = crearDatosPieDesdeMapa(porAsignatura);
  const datosMensuales = crearDatosSolicitudesMensuales(solicitudes);

  const filasFeedback = feedback.map(item => {
    const valores = feedbackPreguntas.map(pregunta => normalizarFeedbackValor(item[pregunta.key])).filter(valor => valor !== null);
    const promedio = valores.length ? (valores.reduce((sum, valor) => sum + valor, 0) / valores.length).toFixed(1) : "";
    return [
      item.creadoEn || "",
      item.correo || "",
      item.eficienciaPrestamo || "",
      item.colaboradores || "",
      item.configuracionIpads || "",
      promedio,
      item.comentario || ""
    ];
  });

  const filasSolicitudes = reservas.map(reserva => [
    reserva.creadoEn || "",
    reserva.fecha || "",
    reserva.hour || "",
    reserva.usuario || "",
    reserva.curso || "",
    obtenerSeccionReserva(reserva),
    obtenerAsignaturaReserva(reserva),
    reserva.cantidad || "",
    reserva.correo || "",
    obtenerObjetivoUsoReserva(reserva),
    reserva.estado || "aprobado"
  ]);

  const filasFeedbackResumen = [
    ["Total responses", feedback.length],
    ["Overall average", metricasFeedback.promedioGeneral ? metricasFeedback.promedioGeneral.toFixed(1) : ""],
    ["Positive ratings", feedback.length ? `${metricasFeedback.favorables}%` : ""],
    ["Lowest area", metricasFeedback.debilidad]
  ];
  const filasRequestResumen = [
    ["Total requests", solicitudes.length],
    ["Total iPads", totalIpads],
    ["Top section", obtenerTopCategoria(datosSeccion)],
    ["Top subject", obtenerTopCategoria(datosAsignatura)]
  ];

  const feedbackPieDatos = feedbackRatingValues.map(valor => ({ label: `${formatearRating(valor)} stars`, value: metricasFeedback.conteosGenerales[valor] || 0 }));
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; color:#1f2937; }
        h1 { color:#1C4169; }
        h2 { color:#1C4169; margin-top:28px; }
        table { border-collapse: collapse; margin: 10px 0 22px; width: 100%; }
        th { background:#1C4169; color:#ffffff; font-weight:700; }
        th, td { border:1px solid #d8e1ee; padding:7px; font-size:12px; vertical-align:top; }
        td { background:#ffffff; }
      </style>
    </head>
    <body>
      <h1>Analytics Export</h1>
      <p>Generated: ${excelValor(new Date().toLocaleString("en-US"))}</p>
      ${tablaExcel("Feedback summary", ["Metric", "Value"], filasFeedbackResumen)}
      ${graficaLineaFeedbackExcel(metricasFeedback.tendencia)}
      ${graficaPieExcel("Overall feedback distribution", feedbackPieDatos, metricasFeedback.totalCalificaciones, feedbackRatingValues.map(valor => feedbackChartColors[valor]))}
      ${tablaExcel("Feedback question summary", ["Question", "Responses", "Average"], metricasFeedback.metricas.map(item => [item.label, item.total, item.total ? item.promedio.toFixed(1) : ""]))}
      ${tablaExcel("Feedback raw data", ["Created at", "Email", "Eficiencia del préstamo", "Servicio de colaboradores", "Configuración y condición de iPads", "Average", "Comment"], filasFeedback)}
      ${tablaExcel("Requests summary", ["Metric", "Value"], filasRequestResumen)}
      ${graficaPieExcel("iPads by section", datosSeccion, totalIpads, requestChartColors)}
      ${graficaPieExcel("iPads by subject", datosAsignatura, totalIpads, requestChartColors)}
      ${graficaBarrasExcel("Requests created by month", datosMensuales, "#F08C28")}
      ${tablaExcel("iPads by section data", ["Section", "iPads"], datosSeccion.map(item => [item.label, item.value]))}
      ${tablaExcel("iPads by subject data", ["Subject", "iPads"], datosAsignatura.map(item => [item.label, item.value]))}
      ${tablaExcel("Requests by month data", ["Month", "Requests"], datosMensuales.map(item => [item.label, item.value]))}
      ${tablaExcel("Requests raw data", ["Created at", "Date", "Hour", "Name", "Course", "Section", "Subject", "iPads", "Email", "Objective", "Status"], filasSolicitudes)}
    </body>
    </html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `analytics-${fechaISO(new Date())}.xls`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
  status.textContent = "Excel export generated.";
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
  renderFeedbackHistorial(feedback);
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
  ["feedbackEficienciaPrestamo", "feedbackColaboradores", "feedbackConfiguracionIpads"].forEach(id => {
    document.getElementById(id).value = "";
    const widget = document.querySelector(`.star-rating-input[data-rating-target="${id}"]`);
    if (widget) actualizarStarRating(widget, "");
  });
  document.getElementById("feedbackCorreo").value = "";
  document.getElementById("feedbackComentario").value = "";
  document.getElementById("feedbackStatus").textContent = "";
}

async function enviarFeedback(event) {
  event.preventDefault();

  const status = document.getElementById("feedbackStatus");
  const boton = document.getElementById("btnFeedbackEnviar");
  const correo = document.getElementById("feedbackCorreo").value.trim();

  if (!correoInstitucionalValido(correo)) {
    status.textContent = "Ingresa un correo institucional @colamericano.edu.co.";
    return;
  }

  const payload = {
    correo,
    eficienciaPrestamo: document.getElementById("feedbackEficienciaPrestamo").value,
    colaboradores: document.getElementById("feedbackColaboradores").value,
    configuracionIpads: document.getElementById("feedbackConfiguracionIpads").value,
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
  if (e.target === document.getElementById("modalOverlay")) actualizarIndicadorScrollSolicitud();
});
document.getElementById("modalSolicitud").addEventListener("scroll", actualizarIndicadorScrollSolicitud);
document.getElementById("seccionSelectButton").addEventListener("click", alternarSeccionSelect);
document.getElementById("seccionSelectOptions").addEventListener("click", e => {
  const opcion = e.target.closest(".custom-select-option");
  if (opcion) seleccionarSeccionDesdeOpcion(opcion);
});
document.addEventListener("click", e => {
  const select = document.getElementById("seccionSelect");
  if (select && !select.contains(e.target)) cerrarSeccionSelect();

  const session = document.querySelector(".sidebar-session");
  if (session && !session.contains(e.target)) cerrarMenuAdminMovil();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") cerrarSeccionSelect();
  if (e.key === "Escape") cerrarMenuAdminMovil();
});
window.addEventListener("resize", actualizarIndicadorScrollSolicitud);
document.getElementById("btnAdmin").addEventListener("click", loginAdmin);
document.getElementById("btnAdminMenu").addEventListener("click", event => {
  event.stopPropagation();
  alternarMenuAdminMovil();
});
document.getElementById("btnPanelAdmin").addEventListener("click", () => {
  cerrarMenuAdminMovil();
  abrirPanelAdmin();
});
document.getElementById("btnSolicitudesRecientes").addEventListener("click", () => {
  cerrarMenuAdminMovil();
  abrirSolicitudesRecientes();
});
document.getElementById("btnLogout").addEventListener("click", logout);
document.getElementById("btnCerrarConfirmacionAdmin").addEventListener("click", cerrarConfirmacionAdmin);
document.getElementById("btnCancelarConfirmacionAdmin").addEventListener("click", cerrarConfirmacionAdmin);
document.getElementById("btnAceptarConfirmacionAdmin").addEventListener("click", aceptarConfirmacionAdmin);
document.getElementById("confirmacionAdminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("confirmacionAdminOverlay")) e.stopPropagation();
});
document.getElementById("btnCerrarLimiteSolicitudes").addEventListener("click", cerrarLimiteSolicitudes);
document.getElementById("limiteSolicitudesOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("limiteSolicitudesOverlay")) e.stopPropagation();
});
document.getElementById("btnDisminuirLimite").addEventListener("click", () => ajustarInputLimite(-1));
document.getElementById("btnAumentarLimite").addEventListener("click", () => ajustarInputLimite(1));
document.getElementById("btnGuardarLimiteDia").addEventListener("click", guardarLimiteDiaDesdeModal);
document.getElementById("btnRestablecerLimiteDia").addEventListener("click", restablecerLimiteDiaDesdeModal);
document.getElementById("btnCerrarReservaAdmin").addEventListener("click", cerrarReservaAdmin);
document.getElementById("btnCancelarReservaAdmin").addEventListener("click", cerrarReservaAdmin);
document.getElementById("btnBloquearReservaAdmin").addEventListener("click", bloquearReservaDesdeModal);
document.getElementById("reservaAdminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("reservaAdminOverlay")) e.stopPropagation();
});
document.getElementById("btnCerrarPanelAdmin").addEventListener("click", cerrarPanelAdmin);
document.getElementById("adminOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("adminOverlay")) e.stopPropagation();
});
document.getElementById("adminTabFeedback").addEventListener("click", () => cambiarAdminAnalyticsTab("feedback"));
document.getElementById("adminTabRequests").addEventListener("click", () => cambiarAdminAnalyticsTab("requests"));
document.getElementById("btnExportarAnalytics").addEventListener("click", exportarAnalyticsExcel);
document.getElementById("btnCerrarSolicitudesRecientes").addEventListener("click", cerrarSolicitudesRecientes);
document.getElementById("recentRequestsOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("recentRequestsOverlay")) e.stopPropagation();
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
