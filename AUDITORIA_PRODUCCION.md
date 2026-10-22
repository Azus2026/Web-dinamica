# Auditoría de seguridad, pruebas y preparación comercial

Fecha: 21 de octubre de 2026. Proyecto local: WEB Hotel / NOMAD ARCH.

## Dictamen

La presentación visual y el cálculo básico de estancias están encaminados, y el proyecto compila. **El flujo actual no está listo para aceptar dinero ni confirmar reservas reales.** Puede prepararse una demostración en Vercel después de desactivar los cobros y distinguir claramente los datos de demostración.

La prioridad es convertir la reserva y el pago en operaciones verificadas por un servidor. Cambiar de framework o añadir más redes cripto no resuelve los problemas actuales.

## Alcance y evidencia

Se revisaron los componentes Astro, scripts del navegador, configuración, lockfile y scripts de QA. Se consultó y actualizó el grafo MCP; sus exclusiones de `src/scripts` y `scripts`, y su información limitada sobre Astro, requirieron completar la revisión leyendo los archivos.

Se ejecutó la compilación con Astro, TypeScript, una auditoría de dependencias y pruebas aisladas. No se enviaron transacciones ni se escribieron datos en Sumac o Supabase. Las pruebas nuevas bloquean o simulan las conexiones externas.

La carpeta no tenía `.git`. No fue posible obtener el contenido del repositorio GitHub enlazado mediante la consulta web; esta auditoría corresponde a la carpeta local. El servidor de Sumac, sus controles de autorización y las políticas RLS de Supabase no están incluidos ni fueron verificados. Tampoco se comprobaron cabeceras de un despliegue real.

Arquitectura observada: Astro 5.18.2, Tailwind 4, TypeScript 5.9.3; salida estática y una sola ruta, `/`. El navegador intenta integrar inventario, reservas, Supabase y wallets directamente. No hay backend de reservas, esquema de base de datos o migraciones en este proyecto.

## Hallazgos que bloquean la operación comercial

### P0 — Un pago pendiente termina declarado confirmado

`src/scripts/web3-checkout.ts:506–530`: `waitForOnChainReceipt` espera hasta 45 segundos y, si nunca encuentra recibo, devuelve `{ confirmed: true }`. Una prueba con proveedor simulado que siempre responde `null` reprodujo el fallo.

Corrección: mantener el estado pendiente y verificar en servidor la red, recibo exitoso, destinatario, token/contrato, importe y confirmaciones necesarias. En transferencias ERC-20, comprobar el evento de transferencia correspondiente. Un timeout no es un pago. Registrar un identificador único de pago para impedir reutilizar una transacción en varias reservas.

### P0 — Simulaciones y pagos de prueba llegan al flujo de reserva

`src/components/CheckoutModal.astro:423, 656–707, 751–752` y `src/scripts/web3-checkout.ts:705–744`: hay un modo por defecto de $0,02, testnet, botón de simulación y un destinatario editable, incluso con opción de enviarse el dinero a sí mismo. Después se llama a `createSumacWebReservation` con el importe completo de la estancia.

En navegador aislado, una estancia de $520 produjo un POST de reserva con etiqueta de simulación de $0,02 y un hash inventado. La UI mostró éxito al responder una API simulada. **Esto demuestra el comportamiento del frontend; no demuestra que el backend real acepte ese pago.** Su validación es imprescindible antes de publicar.

Corrección: separar demostración y producción. La API debe rechazar simulaciones, redes de prueba, importes insuficientes y destinatarios ajenos al hotel. Cotización, destinatario y estado del pago deben proceder del servidor. Ocultar botones en la interfaz no protege una API.

### P0 — Se ofrecen habitaciones ficticias cuando falla el inventario

`src/scripts/sumac-bridge.ts:63–74, 134–174`: ante un error de la API se devuelven diez habitaciones locales, con `ok: true`, sin consultar las reservas de las fechas elegidas. `BookingWidget.astro:294` también asume disponibilidad si aún falta información.

La prueba aislada confirmó diez habitaciones disponibles con la API caída. Esto puede provocar cobros sin capacidad real de alojamiento.

Corrección: mostrar disponibilidad desconocida o servicio temporalmente no disponible y bloquear el cobro. Reservar inventario temporalmente mediante una operación atómica antes de iniciar el pago; liberar el bloqueo al vencer. El polling cada tres segundos no evita dos ventas simultáneas de la última habitación.

### P0 — Seleccionar Solana puede ejecutar una transferencia EVM

`src/scripts/fx-service.ts:142–167` anuncia Solana y Tron; `web3-checkout.ts:480–482` no cambia de red si falta `chainIdHex`, y el flujo de ejecución continúa usando un proveedor EVM.

Con una wallet completamente simulada situada en Arbitrum, elegir Solana/USDC generó una llamada EVM a `eth_sendTransaction` y el resultado afirmó que la red era Solana. No se envió dinero.

Corrección: rechazar redes y combinaciones de tokens no implementadas. Para un primer producto, limitar el alcance a una combinación de red/token verificada. El fallback nativo también usa la cotización de ETH en redes cuyo activo nativo es POL o BNB (`web3-checkout.ts:657–664`), por lo que debe rediseñarse.

### P1 — La conexión con Sumac no es desplegable tal como está

`src/scripts/sumac-bridge.ts:76–82` construye `http://<hostname-del-sitio>:3000`. En Vercel intentaría conectar al dominio público por HTTP y puerto 3000; no conecta automáticamente con el servidor local de Sumac. La propiedad `sumacApiBaseUrl` de `hotel.ts` no es utilizada por ese resolvedor. El recibo genera otro enlace HTTP al puerto 3000 (`CheckoutModal.astro:731–734`).

Corrección: disponer de API HTTPS accesible y configurada por entorno, preferiblemente detrás de un backend del mismo origen. No colocar credenciales privadas de Sumac en el bundle del navegador. Separar el acceso administrativo de los enlaces del huésped.

### P1 — Escritura de datos agregados desde el navegador y RLS sin verificar

`src/scripts/sumac-bridge.ts:59–61, 289–325`: el cliente contiene una clave `anon` y trata de leer y modificar el objeto completo `hotel_store/main_hotel_data` mediante GET y PATCH. Las escrituras fallidas se ignoran y la copia no se espera antes de continuar.

Una clave pública de Supabase no es, por sí sola, un secreto filtrado. La seguridad depende de permisos y RLS. Si el acceso anónimo permite esas operaciones, el alcance incluye lectura o modificación de datos del hotel; si las bloquea, esta sincronización falla silenciosamente. No se verificó cuál de esos casos ocurre. [Documentación de claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Además, leer un JSON completo, añadir una reserva y reemplazarlo puede perder actualizaciones concurrentes. Mover esta operación al servidor, usar tablas de reservas/pagos con transacciones, permisos mínimos, migraciones y pruebas de aislamiento. Para varios hoteles, aplicar `hotel_id` y autorización por hotel en todas las operaciones.

### P1 — Importes y validaciones dependen del navegador

`booking-store.ts:44–48, 76–89`: fechas vacías conservan valores vacíos y generan una noche de cotización. No hay rechazo suficiente de fechas pasadas, estancias inválidas o valores manipulados. `CheckoutModal.astro:631–690` sustituye nombre y documento vacíos por datos inventados y envía un email fijo del hotel en lugar del email del huésped. Los atributos `required` no solucionan esto porque el pago usa un botón y un manejador JavaScript sin validación de formulario.

`fx-service.ts:170–177, 238–244`: los tipos de cambio y precios de tokens son constantes; las funciones llamadas `refreshLiveFxRates` no consultan precios actuales. Las conversiones PEN redondean a enteros.

Corrección: validación de esquema en servidor, límites de estancia y ocupación, fechas según la zona horaria del hotel y cotizaciones con moneda, céntimos/unidades mínimas, tasa aplicada y caducidad. La API debe recalcular el precio; no confiar en `totalAmountUsd`, `totalAmountPen` o `fxRate` recibidos del cliente.

### P1 — Dependencias con avisos de seguridad

`pnpm audit --json` reportó **14 avisos: 1 crítico, 5 altos, 5 moderados y 3 bajos**. El detalle está en `audit/dependencies.json`.

Entre ellos figuran Astro 5.18.2, Sharp 0.34.5 y esbuild 0.27.7. El aviso crítico de Astro afecta al procesamiento de imágenes AVIF no confiables y señala corrección en Astro 7.2.8. Otro aviso de Sharp indica corrección en 0.35.5. Estos son mínimos indicados por los avisos consultados, no una garantía de que cualquier combinación de esas versiones quede libre de todos los problemas. [Aviso oficial de Astro](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2), [aviso oficial de Sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w).

No se observó un flujo que procese AVIF subido por usuarios en este sitio estático. Por ello, presencia en el árbol de dependencias no equivale a explotación demostrada. Hay que migrar a versiones mantenidas, revisar los cambios entre versiones mayores, reconstruir y repetir auditoría y pruebas. Evitar resolverlo con actualizaciones forzadas sin revisar compatibilidad. El servidor de desarrollo configurado con `--host` tampoco debe exponerse públicamente.

## Resultados de las comprobaciones

| Comprobación | Resultado y límite |
| --- | --- |
| `astro build` | Pasó; generó una página estática en `dist/`. Se ejecutó con telemetría desactivada. |
| `tsc --noEmit` | Pasó para TypeScript. No comprueba los componentes `.astro`. |
| `astro check` | No disponible: falta `@astrojs/check`; no se instalaron paquetes. |
| `node audit/runtime-probes.cjs` | 6 comprobaciones: 2 pasan y 4 fallan, reproduciendo confirmación por timeout, disponibilidad ficticia, fechas vacías y red equivocada. |
| `python audit/browser-probes.py` | 14 comprobaciones en Chromium: 8 pasan y 6 fallan. API y servicios externos simulados/bloqueados. |
| QA existente `scripts/qa_test.py` | Se intentó con puerto local aislado y tráfico externo bloqueado; terminó por timeout esperando `networkidle`. Log en `audit/existing-qa.log`. |
| QA Sumac `scripts/qa_sumac_integration.py` | Revisado, no ejecutado contra datos reales: modifica estados de habitaciones y crea reservas. Necesita una base de pruebas aislada y limpieza garantizada. |

En navegador pasaron carga sin excepciones JavaScript, sincronización de precios para 1–4 huéspedes, apertura de checkout, ausencia de desbordamiento horizontal a 390 px y visibilidad del botón principal en ese viewport. Fallaron cierre del modal con Escape, bloqueo de simulación y las cuatro rutas legales. Los resultados están en `audit/browser-results.json` y `audit/runtime-results.json`.

Las pruebas creadas son sondas de auditoría, no una suite completa ni una certificación de seguridad. Los códigos de salida 1 son esperados mientras los fallos sigan presentes. Las capturas `audit/desktop.png` y `audit/mobile.png` se tomaron con fuentes y servicios externos bloqueados.

El QA existente también tiene una incompatibilidad pendiente: busca `href` en `#final-checkout-btn` y luego lo recorta, pero el elemento actual es un `<button>` (`qa_test.py:193–199`). No se alcanzó ese punto en la ejecución que terminó por timeout. Debe reemplazarse la espera global de red por esperas de estados concretos y actualizar las expectativas del checkout.

Astro 5 no verifica tipos durante `astro build`, y `tsc` omite `.astro`: añadir `@astrojs/check` y un comando `check` es necesario para completar esa cobertura. [Documentación de TypeScript de Astro 5](https://v5.docs.astro.build/en/guides/typescript/).

## Pruebas mínimas antes de aceptar dinero

1. Fechas vacías/pasadas, salida anterior a llegada, años bisiestos, cambios de zona horaria, estancia máxima y aforo por categoría.
2. Dos compradores intentando adquirir la última habitación: solo uno debe obtener el bloqueo o confirmación; el otro recibe indisponibilidad sin cobro duplicado.
3. Manipulación de precios, tasa de cambio, habitación y huésped en la petición; el servidor recalcula y rechaza datos inválidos.
4. Pago de importe insuficiente, destinatario incorrecto, otra red/token, transacción pendiente/revertida, hash ya utilizado y simulación/testnet: ninguno confirma una reserva de producción.
5. Webhook falso, repetido o fuera de orden; validar firma, aplicar idempotencia y conservar un historial auditable.
6. Pago correcto con Sumac caído: conservar estado recuperable, reintentar la sincronización y permitir conciliación o devolución; no perder el pago ni cobrar de nuevo.
7. RLS/autorización: un visitante no puede leer huéspedes, modificar inventario o editar reservas ajenas. Si hay varios hoteles, ningún usuario cruza sus datos.
8. E2E completo de reserva, confirmación al email real, cancelación y devolución en entorno de pruebas; Chromium, Firefox y WebKit, además de revisión en móvil real.
9. Accesibilidad por teclado, foco dentro del modal y restauración al cerrar, Escape, selección accesible de habitaciones, errores de formulario y movimiento reducido. Hay soporte inicial de `prefers-reduced-motion` en el recorrido que debe conservarse.

Configurar en GitHub Actions instalación con lockfile congelado, comprobación Astro, lint, pruebas de lógica, integración aislada, E2E y build. El proyecto no tiene scripts `test`, `check` o `lint`, workflow CI ni dependencias reproducibles para los scripts Python/Playwright. No ejecutar el QA que altera habitaciones sobre producción; usar fixtures y limpieza en `finally`.

## Preparación de GitHub

Antes del primer commit:

- Crear `.gitignore` para `node_modules/`, `dist/`, `.astro/`, `.vercel/`, `.env*` —excepto un `.env.example` sin valores reales—, logs y resultados temporales de pruebas.
- Decidir dónde conservar originales de vídeo: `media/` ocupa aproximadamente 100,11 MiB y contiene material de trabajo. No hace falta incluirlo entero en el repositorio de despliegue.
- Añadir README con instalación, arquitectura, comandos, requisitos del backend, variables y procedimiento de despliegue; `.env.example`; política de seguridad y una licencia coherente con la venta del código. Publicar en GitHub no concede automáticamente una licencia comercial a terceros.
- Fijar `engines.node`, `packageManager` y la versión de Node usada en desarrollo/CI; conservar `pnpm-lock.yaml`. `private: true` puede prevenir una publicación accidental en npm, pero no cambia la visibilidad de GitHub.
- Revisar credenciales antes de confirmar y activar alertas de dependencias, protección de secretos y controles de la rama principal según las funciones disponibles en la cuenta.

Después, inicializar Git y vincular `https://github.com/Azus2026/Web-dinamica`. Si el remoto ya contiene historial, integrarlo primero mediante clonación o revisión del remoto; no usar un push forzado para reemplazarlo. No se inicializó Git ni se hizo push durante esta auditoría.

## Preparación de Vercel

Para la parte estática actual: preset **Astro**, directorio raíz del proyecto, instalación `pnpm install --frozen-lockfile`, build `pnpm run build` y salida `dist`. La comprobación de tipos debe formar parte del CI o del comando de build una vez instalada su dependencia. No hace falta añadir un adaptador únicamente para servir este sitio estático; si se implementan endpoints de Astro ejecutados en servidor, entonces configurar el adaptador de Vercel. [Guía oficial de despliegue Astro](https://docs.astro.build/en/guides/deploy/vercel/).

Node 24.x figura entre las versiones admitidas y coincide con la familia usada localmente. Fijar la versión de pnpm elegida, comprobando su selección mediante Corepack o configuración de instalación. [Node en Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [gestores de paquetes](https://vercel.com/docs/package-managers).

Configurar backend HTTPS real y entornos separados para Preview y Production. Mantener secretos en servidor; una variable incorporada al JavaScript público sigue siendo visible aunque proceda de un archivo `.env`.

Añadir una política CSP ajustada al sitio, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`, y verificar las respuestas del despliegue. Empezar CSP en modo de informe para comprobar fuentes, scripts, medios y conexiones de wallets antes de aplicar bloqueos. `vercel.json` es una opción para configurar cabeceras, no un requisito por sí mismo. [Cabeceras de seguridad de Vercel](https://vercel.com/docs/cdn-security/security-headers).

En la API: límites de peticiones y de tamaño, control de bots en operaciones sensibles, validación estricta y permisos mínimos. CORS no sustituye autorización; si se usan sesiones con cookies, diseñar también su protección CSRF. Separar el panel administrativo del acceso público.

Usar un plan que permita actividad comercial: la documentación de Vercel limita Hobby al uso personal no comercial. [Condiciones de Hobby](https://vercel.com/docs/plans/hobby).

## Qué falta para venderlo

### Primer producto para un hotel

- Motor de reservas y pagos con la verificación, bloqueos de inventario y recuperación de errores descritos arriba. Un checkout de tarjeta alojado por una pasarela puede reducir el alcance inicial; la moneda USD mostrada actualmente no constituye un medio de pago bancario implementado.
- Gestión de tarifas, temporadas, impuestos/cargos, disponibilidad y cancelaciones. Puede apoyarse en Sumac si sus capacidades y API lo permiten; eso requiere revisión aparte.
- Email real del huésped, confirmaciones, localización de una reserva de forma segura, cancelación, devolución y recibos coherentes con la operación del hotel.
- Datos y enlaces definitivos del negocio, fotografías/vídeos con derechos de uso y textos comerciales verificados. El contenido sitúa el hotel en Barcelona mientras el checkout usa USD/PEN: hay que definir mercado, moneda de cobro y moneda contable.
- Páginas reales de privacidad, condiciones, aviso legal y cookies según la operación y el país. Las cuatro rutas enlazadas hoy devuelven 404. Definir qué documentos del huésped son necesarios, cuándo se piden y cuánto tiempo se conservan.
- Operación: alertas de pagos pendientes, conciliación con Sumac, registro de eventos sin datos sensibles, copias de seguridad con restauración probada, responsable de incidencias y procedimiento de rollback.
- Acceso administrativo con roles y MFA; edición de contenido/tarifas mediante Sumac o un panel apropiado. Evitar exigir cambios de código para cada modificación comercial.
- Oferta de venta concreta: instalación, personalización, integraciones incluidas, mantenimiento, propiedad de dominio/cuentas/datos, soporte y alcance contractual. Validar el producto con un hotel piloto antes de automatizar la venta a muchos clientes.

### Rendimiento, visibilidad y conversión

`public/` contiene aproximadamente 24,02 MiB de medios. `scroll-world.ts:164–169` pone los cuatro vídeos en precarga automática cuando no se solicita movimiento reducido. Cargar primero la imagen inicial y después los clips cercanos al tramo activo; revisar solicitudes duplicadas al sustituir fuentes móviles.

Medir Lighthouse y métricas reales en un Preview con red móvil; aquí no se midieron LCP, INP, CLS ni una puntuación de rendimiento. Conservar un acceso sencillo a reservar sin obligar a recorrer toda la animación. Añadir canonical, sitemap, robots, imagen Open Graph absoluta y datos estructurados del hotel con información real. Medir el embudo de consulta → inicio de pago → reserva confirmada, minimizando datos personales.

### Si el objetivo es SaaS para varios hoteles

Añadir onboarding, aislamiento de datos y configuración por hotel, roles, dominios, credenciales de integraciones, límites de uso, facturación de la plataforma y exportación/borrado de datos. La instancia fija `main_hotel_data`, el contenido y la wallet globales no proporcionan esa separación. Esta fase es posterior a estabilizar el primer hotel de pago.

## Orden recomendado de trabajo

1. **Demo publicable:** dependencias actualizadas, Git limpio, CI básico, información de demostración explícita, checkout real desactivado y Preview en Vercel.
2. **Piloto comercial:** backend HTTPS, cotizaciones verificadas, inventario atómico, un método de pago completo, políticas reales, notificaciones y pruebas de fallos/concurrencia.
3. **Operación vendible:** monitorización, conciliación, copias y restauración, soporte y configuración editable; después ampliar idiomas, medios de pago o redes según demanda comprobada.
4. **SaaS:** aislamiento por hotel, onboarding y facturación tras validar el piloto.

## Reproducir las sondas de auditoría

Con dependencias locales instaladas:

```powershell
node audit/runtime-probes.cjs
```

Para las pruebas de navegador, se necesita Python con Playwright y Chromium instalados. Compilar y abrir un servidor estático exclusivamente local:

```powershell
pnpm.cmd build
python -m http.server 44321 --bind 127.0.0.1 --directory dist
```

En otra terminal:

```powershell
python audit/browser-probes.py
```

Los servicios externos quedan bloqueados o simulados por el script. La sonda de lógica transpila los módulos existentes dentro de una VM con I/O simulado y expone un helper privado únicamente en memoria. Estos scripts se han añadido para documentar los fallos; no corrigen la aplicación. La compilación actualizó `dist/` y archivos generados por Astro. No se cambiaron archivos de producción de `src/` ni las dependencias.
