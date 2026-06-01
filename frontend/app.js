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

function contarDispositivosReservados(reservas, fecha, excluirId = null) {
  return reservas
    .filter(r => r.fecha === fecha && r.id !== excluirId && r.estado !== "rechazado")
    .reduce((total, r) => total + (parseInt(r.cantidad, 10) || 0), 0);
}

function validarCapacidadDiaria(reservas, fecha, cantidad, excluirId = null) {
  const cantidadSolicitada = parseInt(cantidad, 10);
  const usados = contarDispositivosReservados(reservas, fecha, excluirId);
  const disponibles = obtenerMaxDispositivosPorDia(fecha) - usados;

  if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada <= 0) {
    return { error: "Ingresa una cantidad válida ❌" };
  }

  if (cantidadSolicitada > disponibles) {
    return {
      error: "No hay suficientes iPads disponibles para ese día."
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
  const limiteHorario = validarLimiteSolicitudesHorario(reservas, payload.fecha, payload.hour);
  if (limiteHorario.error) return { error: limiteHorario.error };
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === payload.fecha && (b.hour === payload.hour || b.hour === null)))
    return { error: "Este horario está bloqueado 🚫" };
  const capacidad = validarCapacidadDiaria(reservas, payload.fecha, payload.cantidad);
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

  reservas.push(nueva);
  guardarReservasLocal(reservas);
  return { message: "OK", reserva: nueva };
}

async function validarReservaAPI(payload) {
  const reservas = leerReservasLocal();
  const limiteHorario = validarLimiteSolicitudesHorario(reservas, payload.fecha, payload.hour);
  if (limiteHorario.error) return { error: limiteHorario.error };
  const bloqueos = leerBloqueosLocal();
  if (bloqueos.find(b => b.fecha === payload.fecha && (b.hour === payload.hour || b.hour === null)))
    return { error: "Este horario está bloqueado 🚫" };
  const capacidad = validarCapacidadDiaria(reservas, payload.fecha, payload.cantidad);
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
  renderSemana();
}

function actualizarBotonesAdmin() {
  const sesionActiva = modoAdmin || rol === "coordinador";
  const sessionUserBadge = document.getElementById("sessionUserBadge");
  document.getElementById("btnAdmin").style.display  = sesionActiva ? "none"  : "block";
  document.getElementById("btnPanelAdmin").style.display = modoAdmin ? "block" : "none";
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
  document.getElementById("responsabilidadOverlay").style.display = "none";
  pendingReservaPayload = null;
  pendingFecha = pendingHour = null;
}

async function aceptarResponsabilidad() {
  if (!pendingReservaPayload) return;

  const data = await crearReservaAPI(pendingReservaPayload);
  if (data.error) {
    alert(data.error);
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

    const bloqueadoDiaCompleto = bloqueos.find(b => b.fecha === fechaStr && b.hour === null);

    const col = document.createElement("div");
    col.className = "day-column";
    if (!perteneceAlMesSeleccionado) col.classList.add("outside-month");

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

      if (!tieneReservaExtendida() && !disponibleParaProfesor) {
        cell.classList.add("no-disponible");
        cell.innerHTML = `<span class="cell-hora">${hour}</span><span class="cell-libre">Not available</span>`;
        col.appendChild(cell);
        return;
      }

      const bloqueado = bloqueadoDiaCompleto || bloqueos.find(b =>
        b.fecha === fechaStr && (b.hour === hour || b.hour === null));
      const reservasHorario = reservas.filter(r =>
        r.fecha === fechaStr && r.hour === hour && r.estado !== "rechazado");
      const reserva = reservasHorario[0];
      const limiteHorario = obtenerLimiteSolicitudesPorHora(fechaStr);
      const solicitudesUsadas = reservasHorario.length;
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
            <span class="cell-detalle">📋 ${solicitudesUsadas}/${limiteHorario}</span>
          </div>
          <div class="cell-row cell-row-info">
            <div class="cell-reservas">${renderReservasHorario(reservasHorario)}</div>
          </div>`;
        if (modoAdmin) {
          cell.style.cursor = "pointer";
          cell.addEventListener("click", () => mostrarOpcionesAdmin(reservasHorario, fechaStr, hour));
        }
      } else {
        cell.classList.add("disponible");
        const textoCupo = `${solicitudesUsadas}/${limiteHorario}`;
        cell.innerHTML = `
          <div class="cell-row cell-row-top">
            <span class="cell-hora">${hour}</span>
            <span class="cell-libre">Disponible</span>
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
  document.getElementById("limiteSolicitudesStatus").textContent = `Default: ${defaultValue}`;
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
  { key: "wifi", label: "Red WiFi" },
  { key: "colaboradores", label: "Colaboradores" },
  { key: "dispositivos", label: "Dispositivos" }
];

const feedbackLabels = {
  5: "Excelente",
  4: "Buena",
  3: "Aceptable",
  2: "Regular",
  1: "Deficiente"
};

function escaparHTML(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function activarAdminTab(tab) {
  const feedbackActivo = tab === "feedback";
  document.getElementById("tabFeedback").classList.toggle("active", feedbackActivo);
  document.getElementById("tabOpciones").classList.toggle("active", !feedbackActivo);
  document.getElementById("adminFeedbackView").classList.toggle("active", feedbackActivo);
  document.getElementById("adminOpcionesView").classList.toggle("active", !feedbackActivo);
}

function cerrarPanelAdmin() {
  document.getElementById("adminOverlay").style.display = "none";
}

async function abrirPanelAdmin() {
  if (!modoAdmin) return;
  document.getElementById("adminOverlay").style.display = "flex";
  activarAdminTab("feedback");
  await renderPanelFeedback();
}

function calcularMetricasFeedback(feedback) {
  const metricas = feedbackPreguntas.map(pregunta => {
    const valores = feedback
      .map(item => parseInt(item[pregunta.key], 10))
      .filter(valor => Number.isInteger(valor) && valor >= 1 && valor <= 5);
    const total = valores.length;
    const promedio = total ? valores.reduce((sum, valor) => sum + valor, 0) / total : 0;
    const conteos = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    valores.forEach(valor => { conteos[valor] += 1; });
    return { ...pregunta, valores, total, promedio, conteos };
  });

  const conDatos = metricas.filter(metrica => metrica.total > 0);
  const promedioGeneral = conDatos.length
    ? conDatos.reduce((sum, metrica) => sum + metrica.promedio, 0) / conDatos.length
    : 0;
  const ordenadas = [...conDatos].sort((a, b) => b.promedio - a.promedio);

  return {
    metricas,
    promedioGeneral,
    fortaleza: ordenadas[0]?.label || "-",
    debilidad: ordenadas[ordenadas.length - 1]?.label || "-"
  };
}

function renderAdminCharts(metricas) {
  const contenedor = document.getElementById("adminCharts");
  contenedor.innerHTML = metricas.map(metrica => {
    const max = Math.max(...Object.values(metrica.conteos), 1);
    const filas = [5, 4, 3, 2, 1].map(valor => {
      const cantidad = metrica.conteos[valor];
      const ancho = Math.round((cantidad / max) * 100);
      return `
        <div class="admin-bar-row">
          <span>${feedbackLabels[valor]}</span>
          <div class="admin-bar-track"><span class="admin-bar-fill" style="width:${ancho}%"></span></div>
          <strong>${cantidad}</strong>
        </div>`;
    }).join("");

    const promedio = metrica.total ? metrica.promedio.toFixed(1) : "-";
    return `
      <article class="admin-chart">
        <h4>${metrica.label}</h4>
        <p class="admin-chart-meta">Promedio: ${promedio} - Respuestas: ${metrica.total}</p>
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
    contenedor.innerHTML = '<p class="admin-empty">Aun no hay comentarios registrados.</p>';
    return;
  }

  contenedor.innerHTML = comentarios.map(item => {
    const fecha = item.creadoEn
      ? new Date(item.creadoEn).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "Sin fecha";
    return `
      <article class="admin-comment">
        <p>${escaparHTML(item.comentario)}</p>
        <time>${escaparHTML(fecha)}</time>
      </article>`;
  }).join("");
}

async function renderPanelFeedback() {
  const status = document.getElementById("adminStatus");
  status.textContent = "Cargando feedback...";

  const data = await obtenerFeedbackAdmin();
  if (data.error) {
    status.textContent = data.error;
    return;
  }

  const feedback = Array.isArray(data) ? data : [];
  const { metricas, promedioGeneral, fortaleza, debilidad } = calcularMetricasFeedback(feedback);

  document.getElementById("adminTotalFeedback").textContent = feedback.length;
  document.getElementById("adminPromedioGeneral").textContent = promedioGeneral ? promedioGeneral.toFixed(1) : "-";
  document.getElementById("adminFortaleza").textContent = fortaleza;
  document.getElementById("adminDebilidad").textContent = debilidad;

  renderAdminCharts(metricas);
  renderAdminComentarios(feedback);
  status.textContent = feedback.length ? "Feedback actualizado." : "Aun no hay respuestas de feedback.";
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

function limpiarFeedback() {
  ["feedbackWifi", "feedbackColaboradores", "feedbackDispositivos"].forEach(id => {
    document.getElementById(id).value = "";
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
document.getElementById("tabFeedback").addEventListener("click", () => activarAdminTab("feedback"));
document.getElementById("tabOpciones").addEventListener("click", () => activarAdminTab("opciones"));
document.getElementById("btnRefrescarFeedback").addEventListener("click", renderPanelFeedback);
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
