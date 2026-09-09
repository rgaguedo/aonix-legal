/* Bandeja del Libro de Reclamaciones — AONNIX E.I.R.L.
 *
 * Inicio de sesión con Cognito por OAuth2 «authorization code» + PKCE. PKCE y
 * no «implicit»: el flujo implícito devuelve el token en la URL, que acaba en
 * el historial del navegador y en los registros de cualquier intermediario. Con
 * PKCE lo que viaja por la URL es un código de un solo uso, inservible sin el
 * verificador que nunca sale de esta pestaña.
 *
 * El token vive en memoria, no en localStorage: así no sobrevive al cierre de
 * la pestaña y un XSS en otra página de aonnix.com no puede leerlo.
 */
(function () {
    "use strict";

    var CFG = window.BANDEJA_CONFIG || {};
    var sesion = { token: null, correo: null, expira: 0, grupos: [] };

    // Los tres perfiles. Quien manda es el servidor —comprueba el grupo en cada
    // petición—, pero la pantalla tiene que decir la verdad desde el principio:
    // ofrecer un cuadro de respuesta a quien no puede responder es prometer algo
    // que se romperá al pulsar el botón.
    var PERFILES = {
        "libro-admin":   { nombre: "Administrador", responde: true,  enClaro: true },
        "libro-agente":  { nombre: "Atención",      responde: true,  enClaro: true },
        "libro-lectura": { nombre: "Consulta",      responde: false, enClaro: false }
    };

    function perfil() {
        for (var i = 0; i < sesion.grupos.length; i++) {
            if (PERFILES[sesion.grupos[i]]) { return PERFILES[sesion.grupos[i]]; }
        }
        return { nombre: "Sin perfil", responde: false, enClaro: false };
    }
    var hojaAbierta = null;

    var $ = function (id) { return document.getElementById(id); };

    /* ---------------- PKCE ---------------- */
    function aleatorio(n) {
        var b = new Uint8Array(n);
        crypto.getRandomValues(b);
        return base64url(b);
    }
    function base64url(bytes) {
        var s = btoa(String.fromCharCode.apply(null, new Uint8Array(bytes)));
        return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    async function reto(verificador) {
        var hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador));
        return base64url(hash);
    }

    async function entrar() {
        var verificador = aleatorio(48);
        var estado = aleatorio(16);
        // sessionStorage y no localStorage: el verificador solo tiene sentido
        // durante este viaje de ida y vuelta, y muere con la pestaña.
        sessionStorage.setItem("pkce", verificador);
        sessionStorage.setItem("estado", estado);
        var url = CFG.LOGIN + "/oauth2/authorize?response_type=code" +
            "&client_id=" + encodeURIComponent(CFG.CLIENTE) +
            "&redirect_uri=" + encodeURIComponent(CFG.REDIRECCION) +
            "&scope=" + encodeURIComponent("openid email") +
            "&state=" + estado +
            "&code_challenge_method=S256&code_challenge=" + (await reto(verificador));
        window.location.assign(url);
    }

    async function canjear(codigo, estado) {
        var esperado = sessionStorage.getItem("estado");
        var verificador = sessionStorage.getItem("pkce");
        sessionStorage.removeItem("estado");
        sessionStorage.removeItem("pkce");
        // Sin esta comprobación, un tercero podría inducirte a canjear SU código
        // y dejarte trabajando dentro de su sesión sin que lo notaras.
        if (!esperado || estado !== esperado || !verificador) {
            throw new Error("La respuesta del inicio de sesión no coincide con esta pestaña.");
        }
        var cuerpo = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CFG.CLIENTE,
            code: codigo,
            redirect_uri: CFG.REDIRECCION,
            code_verifier: verificador
        });
        var r = await fetch(CFG.LOGIN + "/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: cuerpo
        });
        if (!r.ok) { throw new Error("No se pudo completar el inicio de sesión."); }
        var d = await r.json();
        sesion.token = d.id_token;
        sesion.expira = Date.now() + (d.expires_in || 3600) * 1000;
        try {
            var carga = JSON.parse(atob(d.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            sesion.correo = carga.email || carga["cognito:username"] || "";
            sesion.grupos = carga["cognito:groups"] || [];
            if (typeof sesion.grupos === "string") { sesion.grupos = [sesion.grupos]; }
        } catch (e) { sesion.correo = ""; sesion.grupos = []; }
    }

    function salir() {
        sesion = { token: null, correo: null, expira: 0, grupos: [] };
        window.location.assign(CFG.LOGIN + "/logout?client_id=" + encodeURIComponent(CFG.CLIENTE) +
            "&logout_uri=" + encodeURIComponent(CFG.REDIRECCION));
    }

    /* ---------------- API ---------------- */
    async function pedir(ruta, opciones) {
        if (!sesion.token || Date.now() > sesion.expira) {
            mostrar("login");
            throw new Error("La sesión caducó. Vuelve a entrar.");
        }
        opciones = opciones || {};
        opciones.headers = Object.assign({ "Authorization": sesion.token }, opciones.headers || {});
        var r = await fetch(ruta, opciones);
        if (r.status === 401 || r.status === 403) { mostrar("login"); throw new Error("Sesión no válida."); }
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) { var e = new Error(d.mensaje || "Error " + r.status); e.datos = d; e.estado = r.status; throw e; }
        return d;
    }

    /* ---------------- pintado ---------------- */
    function mostrar(vista) {
        ["login", "listado", "hoja"].forEach(function (v) {
            $("vista-" + v).hidden = v !== vista;
        });
        $("barra-sesion").hidden = vista === "login";
        document.body.classList.toggle("en-acceso", vista === "login");
    }

    function aviso(texto, tipo) {
        var caja = $("aviso");
        caja.textContent = texto;
        caja.className = "bn-aviso" + (tipo ? " bn-aviso--" + tipo : "");
        caja.hidden = !texto;
    }

    var MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto",
                 "septiembre","octubre","noviembre","diciembre"];
    function fechaLarga(iso) {
        var p = String(iso).split("-");
        return p.length === 3 ? (+p[2]) + " de " + MESES[+p[1] - 1] + " de " + p[0] : iso;
    }

    function habiles(n) {
        return n === 1 ? "1 día hábil" : n + " días hábiles";
    }

    function urgencia(dias, estado) {
        if (estado === "RESPONDIDA") { return { clase: "ok", texto: "Respondida" }; }
        if (dias < 0) { return { clase: "vencida", texto: "Venció hace " + habiles(Math.abs(dias)) }; }
        if (dias === 0) { return { clase: "hoy", texto: "Vence hoy" }; }
        if (dias === 1) { return { clase: "cerca", texto: "Vence mañana" }; }
        if (dias <= 3) { return { clase: "cerca", texto: "Faltan " + habiles(dias) }; }
        return { clase: "normal", texto: "Faltan " + habiles(dias) };
    }

    /* El listado se guarda tal como llegó y se vuelve a pintar en memoria al
       buscar o reordenar. Ir al servidor por cada tecla sería gastar una llamada
       autenticada para filtrar cincuenta filas que ya están aquí. */
    var hojasCargadas = [];

    function correlativoDe(numero) {
        // El número es la posición en la serie. `PRUEBA-000000011-2026` y
        // `000000011-2026` comparten los nueve dígitos; ordenar por la cadena
        // pondría todas las de prueba juntas y no por antigüedad.
        var m = String(numero).match(/(\d{9})/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function ordenar(hojas, criterio) {
        var copia = hojas.slice();
        if (criterio === "urgentes") {
            // Lo que vence antes, primero: el orden en que hay que atenderlas.
            copia.sort(function (a, b) {
                return a.fechaLimiteRespuesta.localeCompare(b.fechaLimiteRespuesta) ||
                       correlativoDe(a.numero) - correlativoDe(b.numero);
            });
        } else {
            copia.sort(function (a, b) { return correlativoDe(b.numero) - correlativoDe(a.numero); });
        }
        return copia;
    }

    function coincide(hoja, texto) {
        if (!texto) { return true; }
        var aguja = texto.toLowerCase();
        return [hoja.numero, hoja.tipo, hoja.consumidor, hoja.descripcion]
            .some(function (campo) { return String(campo || "").toLowerCase().indexOf(aguja) !== -1; });
    }

    function avisarDeLoQueVence(hojas) {
        var aviso = $("alerta-plazos");
        var vencidas = hojas.filter(function (h) { return h.estado !== "RESPONDIDA" && h.diasHabilesRestantes < 0; }).length;
        var hoy = hojas.filter(function (h) { return h.estado !== "RESPONDIDA" && h.diasHabilesRestantes === 0; }).length;
        if (!vencidas && !hoy) { aviso.hidden = true; aviso.textContent = ""; return; }
        var partes = [];
        if (vencidas) { partes.push(vencidas + (vencidas === 1 ? " hoja vencida" : " hojas vencidas")); }
        if (hoy) { partes.push(hoy + (hoy === 1 ? " vence hoy" : " vencen hoy")); }
        aviso.textContent = partes.join(" · ") + ". Ordena por «más urgentes primero» para verlas arriba.";
        aviso.hidden = false;
    }

    function filaVacia(mensaje) {
        var fila = document.createElement("tr");
        fila.className = "bn-fila--vacia";
        var celda = document.createElement("td");
        celda.colSpan = 6;                       // seis columnas, no cinco
        celda.className = "bn-vacio";
        celda.textContent = mensaje;
        fila.appendChild(celda);
        return fila;
    }

    function pintarListado() {
        var cuerpo = $("cuerpo-listado");
        var texto = $("buscar").value.trim();
        var visibles = ordenar(hojasCargadas.filter(function (h) { return coincide(h, texto); }),
                               $("orden").value);
        cuerpo.textContent = "";

        var conteo = $("conteo");
        conteo.textContent = !hojasCargadas.length ? ""
            : texto ? visibles.length + " de " + hojasCargadas.length + " hojas"
                    : hojasCargadas.length + (hojasCargadas.length === 1 ? " hoja" : " hojas");
        // Si el servidor dijo que hay más, se dice: una lista incompleta que
        // parece completa es peor que una lista que avisa de que le falta.
        if (cursorPendiente) {
            conteo.appendChild(document.createTextNode(" · hay más sin cargar "));
            var mas = document.createElement("button");
            mas.type = "button"; mas.className = "bn-enlace";
            mas.textContent = "Cargar el resto";
            mas.addEventListener("click", function () { cargarListado($("filtro").value, true); });
            conteo.appendChild(mas);
        }

        if (!visibles.length) {
            cuerpo.appendChild(filaVacia(
                texto ? "Ninguna hoja coincide con «" + texto + "»."
                      : ($("filtro").value === "PENDIENTE"
                          ? "No hay hojas pendientes de respuesta."
                          : "No hay hojas en este estado.")));
            return;
        }

        visibles.forEach(function (h) {
            var u = urgencia(h.diasHabilesRestantes, h.estado);
            var fila = document.createElement("tr");
            fila.className = "bn-fila bn-fila--" + (u.clase || "normal");
            fila.tabIndex = 0;
            fila.setAttribute("role", "button");
            fila.setAttribute("aria-label",
                (h.estado === "RESPONDIDA" ? "Ver" : "Responder") + " la hoja " + h.numero);
            [
                h.numero,
                h.tipo,
                h.consumidor,
                fechaLarga(h.fechaRegistro),
                fechaLarga(h.fechaLimiteRespuesta),
                u.texto
            ].forEach(function (valor, i) {
                var celda = document.createElement("td");
                // textContent: lo que escribió el consumidor se muestra, no se
                // interpreta. La bandeja es el sitio donde un XSS almacenado
                // tendría más valor para un atacante.
                celda.textContent = valor;
                if (i === 0) { celda.className = "bn-numero"; }
                if (i === 5) { celda.className = "bn-urgencia bn-urgencia--" + (u.clase || "normal"); }
                fila.appendChild(celda);
            });
            var accion = document.createElement("td");
            var boton = document.createElement("button");
            boton.type = "button";
            boton.className = "bn-enlace";
            boton.tabIndex = -1;              // la fila ya es enfocable; no se tabula dos veces
            boton.textContent = h.estado === "RESPONDIDA" ? "Ver" : "Responder";
            accion.appendChild(boton); fila.appendChild(accion);

            function abrir() { abrirHoja(h.numero); }
            fila.addEventListener("click", abrir);
            fila.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
            });
            cuerpo.appendChild(fila);
        });
    }

    /* El servidor devuelve 50 hojas por página y un cursor para seguir. Antes se
       pedía una vez y se tiraba el cursor, así que a partir de la hoja 51 el
       resto no aparecía y nada lo decía.

       Y no era solo que faltaran: el servidor ordena por fecha límite ascendente,
       o sea que esas 50 son las MÁS ANTIGUAS. Buscar u ordenar «más recientes
       primero» sobre ellas habría devuelto respuestas seguras y equivocadas —la
       hoja registrada esta mañana ni siquiera estaría en la lista—.

       Se siguen los cursores hasta agotarlos. Con el volumen de un libro de
       reclamaciones eso es una sola petición durante años; el tope de páginas
       está para que un día raro no se convierta en cien llamadas encadenadas, y
       cuando se alcanza se dice en pantalla en vez de callarlo. */
    var TOPE_DE_PAGINAS = 10;   // 500 hojas
    var cursorPendiente = null;

    async function cargarListado(estado, seguir) {
        aviso("");
        if (!seguir) {
            hojasCargadas = []; cursorPendiente = null;
            $("cuerpo-listado").textContent = "";
            $("cuerpo-listado").appendChild(filaVacia("Cargando…"));
        }
        try {
            var paginas = 0;
            var cursor = seguir ? cursorPendiente : null;
            do {
                var url = CFG.API + "?estado=" + encodeURIComponent(estado) +
                          (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
                var d = await pedir(url);
                hojasCargadas = hojasCargadas.concat(d.hojas || []);
                cursor = d.cursor || null;
                paginas += 1;
            } while (cursor && paginas < TOPE_DE_PAGINAS);
            cursorPendiente = cursor;
            avisarDeLoQueVence(hojasCargadas);
            pintarListado();
        } catch (e) {
            if (!seguir) { hojasCargadas = []; $("cuerpo-listado").textContent = ""; }
            aviso(e.message, "error");
        }
    }

    function dato(lista, etiqueta, valor) {
        if (!valor) { return; }
        var div = document.createElement("div");
        var dt = document.createElement("dt"); dt.textContent = etiqueta;
        var dd = document.createElement("dd"); dd.textContent = valor;
        div.appendChild(dt); div.appendChild(dd); lista.appendChild(div);
    }

    async function abrirHoja(numero) {
        aviso("");
        try {
            var h = await pedir(CFG.API + "/" + encodeURIComponent(numero));
            hojaAbierta = h;
            $("numero-hoja").textContent = "N.° " + h.numero;
            var u = urgencia(h.diasHabilesRestantes, (h.respuestaProveedor || {}).estado);
            var plazo = $("plazo-hoja");
            plazo.textContent = u.texto + " · límite " + fechaLarga(h.fechaLimiteRespuesta);
            plazo.className = "bn-urgencia bn-urgencia--" + (u.clase || "normal");

            var lista = $("datos-hoja"); lista.textContent = "";
            dato(lista, "Tipo", h.detalle.tipo === "RECLAMO" ? "Reclamo" : "Queja");
            dato(lista, "Registrada", fechaLarga(h.fechaRegistro) + ", " + (h.horaRegistro || ""));
            dato(lista, "Consumidor", h.consumidor.nombre);
            dato(lista, "Documento", h.consumidor.tipoDocumento + " " + h.consumidor.numeroDocumento);
            dato(lista, "Domicilio", h.consumidor.domicilio);
            dato(lista, "Teléfono", h.consumidor.telefono);
            dato(lista, "Correo", h.consumidor.email);
            if (h.esMenorDeEdad && h.apoderado) {
                dato(lista, "Apoderado", h.apoderado.nombre + " · " + h.apoderado.telefono +
                     " · " + h.apoderado.email);
            }
            dato(lista, "Bien", (h.bien.tipo === "PRODUCTO" ? "Producto" : "Servicio") +
                 " — " + h.bien.descripcion);
            dato(lista, "Monto reclamado", h.bien.montoReclamado ? "S/ " + h.bien.montoReclamado : "");
            dato(lista, "N.º de pedido", h.bien.numeroPedido);
            dato(lista, "Detalle", h.detalle.detalle);
            dato(lista, "Pedido del consumidor", h.detalle.pedido);

            // El servidor marca la hoja cuando viene con datos tapados. Se lee
            // de ahí y no del token: si los dos se desalinearan, manda el que
            // realmente decidió qué enviar.
            $("aviso-enmascarado").hidden = !h.datosEnmascarados;

            var respuesta = h.respuestaProveedor || {};
            var yaRespondida = respuesta.estado === "RESPONDIDA";
            $("bloque-responder").hidden = yaRespondida || !perfil().responde;
            $("bloque-respondida").hidden = !yaRespondida;
            if (yaRespondida) {
                $("acciones-registradas").textContent = respuesta.accionesAdoptadas || "";
                $("meta-respuesta").textContent =
                    "Respondida el " + fechaLarga(respuesta.fechaComunicacionRespuesta) +
                    " por " + (respuesta.registradaPor || "—") +
                    (respuesta.diasHabilesDeMargen < 0
                        ? " · FUERA DE PLAZO por " + habiles(Math.abs(respuesta.diasHabilesDeMargen))
                        : " · dentro del plazo");
            } else {
                $("acciones").value = "";
            }
            mostrar("hoja");
            window.scrollTo(0, 0);
        } catch (e) { aviso(e.message, "error"); }
    }

    async function enviarRespuesta() {
        var acciones = $("acciones").value.trim();
        if (!acciones) { aviso("Escribe qué se hizo con el reclamo o la queja.", "error"); return; }
        var boton = $("boton-responder");
        boton.disabled = true; boton.textContent = "Guardando…";
        try {
            var d = await pedir(CFG.API + "/" + encodeURIComponent(hojaAbierta.numero) + "/respuesta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accionesAdoptadas: acciones })
            });
            aviso("Respuesta registrada" + (d.consumidorAvisado
                ? " y enviada al consumidor." : ". No se pudo enviar el correo; la constancia sí quedó guardada."),
                d.dentroDelPlazo ? "ok" : "error");
            await abrirHoja(hojaAbierta.numero);
        } catch (e) {
            // 409: otra persona del área respondió mientras esta pestaña estaba abierta.
            aviso(e.message, "error");
            if (e.estado === 409) { await abrirHoja(hojaAbierta.numero); }
        } finally {
            boton.disabled = false; boton.textContent = "Registrar respuesta";
        }
    }

    /* ---------------- arranque ---------------- */
    async function arrancar() {
        $("anio").textContent = new Date().getFullYear();
        if (!CFG.API || !CFG.LOGIN || !CFG.CLIENTE) {
            mostrar("login");
            aviso("La bandeja todavía no está configurada: faltan los valores de bandeja/config.js.", "error");
            $("boton-entrar").disabled = true;
            return;
        }
        $("boton-entrar").addEventListener("click", entrar);
        $("boton-salir").addEventListener("click", salir);
        $("boton-responder").addEventListener("click", enviarRespuesta);
        $("boton-volver").addEventListener("click", function () {
            mostrar("listado"); cargarListado($("filtro").value);
        });
        $("filtro").addEventListener("change", function () { cargarListado(this.value); });
        $("orden").addEventListener("change", pintarListado);
        $("buscar").addEventListener("input", pintarListado);
        $("buscar").addEventListener("search", pintarListado);   // la X de Safari

        var params = new URLSearchParams(window.location.search);
        if (params.get("error")) {
            mostrar("login");
            aviso("El inicio de sesión no se completó.", "error");
            return;
        }
        if (params.get("code")) {
            try {
                await canjear(params.get("code"), params.get("state"));
                // El código se borra de la barra de direcciones en cuanto se
                // canjea: no tiene por qué quedar en el historial.
                history.replaceState({}, "", window.location.pathname);
                $("correo-sesion").textContent = sesion.correo;
                $("perfil-sesion").textContent = perfil().nombre;
                if (!perfil().responde) { document.body.classList.add("solo-lectura"); }
                mostrar("listado");
                await cargarListado("PENDIENTE");
                return;
            } catch (e) {
                mostrar("login"); aviso(e.message, "error"); return;
            }
        }
        mostrar("login");
    }

    arrancar();
})();
