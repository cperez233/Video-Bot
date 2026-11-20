# Video Bot

Bot personal de WhatsApp para probar cosas. Le mandas un link de **X (tweet)** o de **YouTube** y responde en el mismo chat con el contenido ya descargado, sin salir de WhatsApp.

## Qué hace

Al recibir un link responde con:

1. **El video o la foto** del post (varias fotos si el tweet trae más de una).
2. **El texto o título**, el autor y los **likes**, en el pie de foto.
3. Un mensaje aparte con los **5 comentarios con más likes** (autor y texto).

Casos especiales:

- Link no soportado → aviso corto.
- Sin comentarios disponibles → aviso corto.
- Tweet que cita a otro → usa el video o la foto del tweet citado y lo avisa.
- Solo responde a los números de la lista blanca (`ALLOWED_NUMBERS`). El resto se ignora.

## Cómo funciona

```
mensaje con link ──► bot.js (Baileys) ──► lib.js
                                           ├─ YouTube: yt-dlp (metadatos + comentarios + video)
                                           ├─ X: API pública de embeds (texto, likes, fotos) + yt-dlp (video)
                                           └─ ffmpeg: comprime el video para que quepa en WhatsApp
```

- **Video:** se descarga a ≤720p. Si pesa más de ~16 MB, ffmpeg lo comprime (hasta 4 intentos). Si aun así no cabe, se manda como **documento**.
- **Videos largos:** más de 20 min no se descargan (se envía solo texto y likes).
- **Sesión:** se guarda en `./auth/`, así que el QR se escanea solo la primera vez.
- Los pies de foto de WhatsApp se cortan en ~1024 caracteres, por eso los comentarios van en un mensaje separado.

## Archivos

| Archivo | Para qué |
|---|---|
| `bot.js` | Conexión a WhatsApp, lista blanca, envío de respuestas y modo `--dry-run` |
| `lib.js` | Detección de links, yt-dlp, ffmpeg y armado de los mensajes |
| `env.js` | Carga el `.env` |

## Requisitos

- Node.js 20.12 o más nuevo
- `ffmpeg`
- `yt-dlp`: `pip install -U "yt-dlp[default]"`

## Uso

```bash
npm install
cp .env.example .env     # pon tu número en ALLOWED_NUMBERS
npm start                # primera vez: escanea el QR con el número secundario
```

En WhatsApp: Ajustes → Dispositivos vinculados → Vincular un dispositivo. Después, desde tu número autorizado, mándale un link al número secundario (no en el chat "Message yourself").

Probar sin WhatsApp (imprime lo que enviaría y deja los archivos en `out/`):

```bash
node bot.js --dry-run https://x.com/usuario/status/123456789
```

## Configuración (`.env`)

| Variable | Descripción |
|---|---|
| `ALLOWED_NUMBERS` | **Obligatoria.** Números autorizados, solo dígitos con código de país, separados por coma (ej. Colombia: `573001234567`) |
| `MAX_DURATION_MIN` | Duración máxima de video a descargar (por defecto 20) |
| `MAX_DOC_MB` | Tamaño máximo para enviar como documento (por defecto 100) |
| `YTDLP_COOKIES` | Ruta a un `cookies.txt` si YouTube pide verificar que no eres bot |
| `YTDLP_BIN` / `FFMPEG_BIN` / `FFPROBE_BIN` | Rutas personalizadas a los ejecutables |

`.env` y `auth/` están en `.gitignore`: no se suben al repo.

## Limitaciones conocidas

- **Comentarios de X:** no se pueden leer sin una cuenta con sesión iniciada. El bot avisa cuántas respuestas tiene el tweet.
- **YouTube** puede bloquear IPs de servidores o de nube (error 429). Desde una conexión doméstica suele funcionar; si no, usa `YTDLP_COOKIES`.
- Es un bot personal: usa WhatsApp Web de forma no oficial (Baileys), así que úsalo con un número secundario.
