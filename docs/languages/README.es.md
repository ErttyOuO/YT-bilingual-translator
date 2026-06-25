# YT Bilingual Subtitle Translator

Extensión open-source para Firefox que convierte los subtítulos de YouTube en una capa de aprendizaje con subtítulos bilingües y tarjetas de vocabulario.

[繁體中文](../../README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md)

![Vista previa de la interfaz](../assets/hero-zh.png)

## Funciones principales

- Muestra subtítulos originales y la traducción al idioma de destino elegido por el usuario.
- Usa un motor transcript-first basado en timedtext / json3 cuando está disponible.
- Une fragmentos de subtítulos automáticos para mejorar la lectura.
- Traduce por lotes las próximas líneas para reducir esperas.
- Cambia automáticamente entre proveedores gratuitos si uno falla o se limita.
- Tarjetas interactivas para vocabulario inglés con explicación EN-EN y EN-ZH.
- Lista local de vocabulario con exportación JSON.
- Posición de subtítulos arrastrable por video.

## Instalación de prueba en Firefox

1. Descarga o clona este repositorio.
2. Abre Firefox y visita `about:debugging#/runtime/this-firefox`.
3. Haz clic en **Load Temporary Add-on**.
4. Selecciona `manifest.json` en la raíz del proyecto.
5. Abre YouTube y activa los subtítulos.

## Flujo técnico

```text
Página de YouTube
→ content script crea la interfaz de subtítulos
→ page bridge lee player response y captionTracks
→ timedtext json3 se obtiene y analiza
→ se fusionan fragmentos de subtítulos automáticos
→ se pretraducen las próximas líneas por lote
→ background script traduce con caché y failover
→ se muestran subtítulos bilingües y tarjetas de palabras
```


## Actualización v0.18

El popup ahora está organizado por pestañas. El asistente inicial permite elegir el idioma de la interfaz y el idioma de destino de los subtítulos por separado. El idioma de origen se detecta automáticamente.
