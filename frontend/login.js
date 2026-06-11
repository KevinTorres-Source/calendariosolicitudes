const API = window.location.port === "3000" ? window.location.origin : "http://localhost:3000";

const passwordInput = document.getElementById("loginPassword");
const capsWarning = document.getElementById("capsWarning");
const ADMIN_PASSWORD_HASH = "82c290496e4e4d7a2b7140d5b6fab572d5addb286728e3917ecb3cd88f556a59";
const COORDINATOR_PASSWORD_HASHES = {
  preescolar: "a0073899be76ab0f7125790781b97edc535f41a6f9cc499fea546a7155f77498",
  secundaria: "160ba271a38f345c079f1d8efd6a125b4fa7ad8a77af9dc187fba140a780e053",
  primaria: "8b2c3719321e10bd0ca29fa596ed3e71923869497533e57a3f30a3c16f831feb"
};

function actualizarAvisoMayusculas(event) {
  if (!event.getModifierState) return;
  capsWarning.hidden = !event.getModifierState("CapsLock");
}

passwordInput.addEventListener("keydown", actualizarAvisoMayusculas);
passwordInput.addEventListener("keyup", actualizarAvisoMayusculas);
passwordInput.addEventListener("blur", () => {
  capsWarning.hidden = true;
});

async function sha256(texto) {
  const data = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function validarCredencialesLocales(usuario, password) {
  const username = usuario.trim().toLowerCase();
  const passwordHash = await sha256(password.trim());

  if (username === "admin" && passwordHash === ADMIN_PASSWORD_HASH) {
    return { token: "admin-token-seguro", rol: "admin" };
  }

  if (COORDINATOR_PASSWORD_HASHES[username] && passwordHash === COORDINATOR_PASSWORD_HASHES[username]) {
    return { token: "coordinador-token-seguro", rol: "coordinador" };
  }

  return null;
}

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
    const credencialesLocales = await validarCredencialesLocales(usuario, password);
    if (credencialesLocales) {
      entrarConRol(credencialesLocales.token, credencialesLocales.rol, usuario);
      return;
    }

    status.textContent = "Credenciales incorrectas.";
    submit.disabled = false;
  }
});
