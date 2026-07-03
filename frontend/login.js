function obtenerAPIBase() {
  const apiConfigurada = window.API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content;
  if (apiConfigurada) return String(apiConfigurada).replace(/\/$/, "");

  const hostLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  if (hostLocal && window.location.port !== "3000") return "http://localhost:3000";

  return window.location.origin;
}

const API = obtenerAPIBase();

const passwordInput = document.getElementById("loginPassword");
const capsWarning = document.getElementById("capsWarning");

function actualizarAvisoMayusculas(event) {
  if (!event.getModifierState) return;
  capsWarning.hidden = !event.getModifierState("CapsLock");
}

passwordInput.addEventListener("keydown", actualizarAvisoMayusculas);
passwordInput.addEventListener("keyup", actualizarAvisoMayusculas);
passwordInput.addEventListener("blur", () => {
  capsWarning.hidden = true;
});

function entrarConRol(token, rol, usuario) {
  localStorage.setItem("token", token);
  localStorage.setItem("rol", rol);
  localStorage.setItem("usuarioSesion", usuario);
  localStorage.setItem("modoAdmin", rol === "admin" ? "true" : "false");
  window.location.assign("index.html");
}

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const usuario = document.getElementById("loginUsuario").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const status = document.getElementById("loginStatus");
  const submit = document.getElementById("btnLoginSubmit");

  if (!usuario || !password) {
    status.textContent = "Ingresa tu usuario y contrasena.";
    return;
  }

  status.textContent = "Validando credenciales...";
  submit.disabled = true;

  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usuario, password })
    });
    const data = await res.json();

    if (!res.ok || !data.token) {
      status.textContent = "Credenciales incorrectas.";
      submit.disabled = false;
      return;
    }

    entrarConRol(data.token, data.rol || "admin", data.usuario || usuario);
  } catch {
    status.textContent = "No se pudo conectar con el servidor.";
    submit.disabled = false;
  }
});
