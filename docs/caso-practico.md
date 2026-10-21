# Caso práctico — Prueba técnica XTRIM

**Cargo:** Administrador eCommerce

**Escenario:** Un sistema similar al desarrollado presenta una caída del 40 % en el tráfico orgánico, fallos intermitentes en el formulario de leads y lentitud en dispositivos móviles.

## 1. ¿Qué revisarías primero?

La revisión comenzaría por identificar **cuándo aparecieron los problemas y qué cambios se realizaron antes de que comenzaran**. Para ello, se consultaría la documentación técnica y funcional, la arquitectura del sistema, los contratos de las API y el historial de despliegues. Conocer cómo se comunican el frontend, los servicios y la base de datos permite dirigir las verificaciones hacia los componentes involucrados, en lugar de modificar código sin haber localizado la causa.

También se comprobaría **qué versión fue probada y aprobada en el ambiente de certificación y qué versión está desplegada en producción**. Se contrastarían las configuraciones, las dependencias, los recursos de infraestructura, los esquemas de datos y los servicios externos de ambos ambientes. Una funcionalidad puede superar las pruebas de QA y fallar en producción si consume una API distinta, recibe otra estructura de respuesta o requiere un dato que no se contempló durante la certificación.

La primera prioridad operativa sería **el formulario de captación**, por su impacto directo en el registro de clientes potenciales. Se verificaría la disponibilidad del endpoint que recibe los leads y, sobre todo, si mantiene el contrato esperado por el frontend: campos obligatorios, tipos de datos, formato de envío, códigos HTTP y estructura de respuesta. Por ejemplo, un nuevo campo requerido o una propiedad renombrada podrían impedir el registro aunque la API continúe disponible.

En paralelo, se verificaría la magnitud y el origen de la caída del tráfico orgánico y se identificarían las páginas móviles más lentas. Es importante distinguir ambos indicadores: **una reducción del tráfico orgánico no equivale a una reducción de leads**. Un formulario defectuoso puede disminuir la conversión, pero por sí solo no explica que los buscadores envíen un 40 % menos de visitas.

## 2. ¿Cómo abordarías el diagnóstico?

El diagnóstico se realizaría de forma ordenada, reproduciendo cada problema y buscando evidencia que permita confirmar o descartar sus posibles causas.

**Formulario de leads.** Se reproduciría el envío con datos de prueba y se examinaría la solicitud desde las herramientas de desarrollo del navegador: URL, método, cuerpo enviado, tiempo de respuesta y código HTTP. Esa información se compararía con la documentación de la API y las validaciones del backend. Después se ejecutaría una solicitud equivalente en certificación y producción para determinar si existe alguna diferencia en el contrato, la configuración o el comportamiento de los servicios.

Si el problema persiste, se seguiría el recorrido de la petición desde el frontend hasta la API y la base de datos, correlacionando errores y registros para comprobar si el lead se almacena correctamente. También se revisarían tiempos de espera, límites de solicitudes, conexiones a PostgreSQL y posibles fallos bajo concurrencia. La disponibilidad de una ruta de salud no sería suficiente para dar por correcto el registro: habría que verificar el flujo completo.

**Caída del tráfico orgánico.** Se contrastarían períodos comparables en Google Search Console y Google Analytics 4, identificando cuándo comenzó la caída y si afecta a todo el sitio o a páginas, búsquedas o dispositivos específicos. En Search Console se analizarían clics, impresiones, posicionamiento e indexación; en Analytics se revisarían las sesiones orgánicas y posibles problemas de medición.

Posteriormente, se comprobarían las URLs, redirecciones, respuestas HTTP, etiquetas `noindex` y `canonical`, metadatos, `robots.txt`, `sitemap.xml` y contenido HTML visible para los buscadores. Los hallazgos se contrastarían con el historial de cambios del sitio. También se consideraría si una experiencia móvil deficiente está afectando al rendimiento del sitio, sin asumir que sea la única causa de la disminución.

**Lentitud en móviles.** Se analizarían las páginas de mayor relevancia comercial mediante Lighthouse, PageSpeed Insights y las herramientas de red y rendimiento del navegador, en condiciones similares a las de los usuarios. Se comprobaría primero la carga de imágenes, fuentes, hojas de estilo y scripts, ya que recursos pesados o bloqueantes pueden retrasar la visualización y la interacción.

También se revisarían el JavaScript ejecutado, el renderizado, la respuesta del servidor y los tiempos de consulta a los servicios y a la base de datos. Se medirían **LCP, INP y CLS**, además del tiempo de respuesta inicial, para ubicar el cuello de botella. Los resultados se compararían entre certificación y producción considerando sus diferencias de infraestructura, caché y servicios.

Finalmente, se relacionarían las fechas de los tres incidentes con los despliegues realizados. Si comenzaron al mismo tiempo, se investigaría una posible causa compartida; si no, se tratarían como problemas independientes hasta contar con evidencia.

## 3. ¿Qué posibles soluciones propondrías?

Las soluciones dependerían de las causas identificadas durante el diagnóstico; no se aplicarían cambios generales sin comprobar qué componente presenta el problema.

**Para el formulario**, si se detecta una incompatibilidad entre frontend y API, se corregiría el contrato o se revertiría temporalmente el cambio que originó la falla. Se reforzarían las validaciones, el manejo de respuestas y los mensajes de error. Además, se incorporarían pruebas de integración y de regresión para verificar que los campos enviados y las respuestas recibidas sigan siendo compatibles. La solución se validaría comprobando que el envío genera un registro persistido y visible en el CRM, tanto en certificación como en producción, utilizando datos controlados.

**Para el tráfico orgánico**, se corregirían los problemas concretos de indexación, redirecciones, rutas, metadatos o renderizado que aparezcan en el análisis. Se mantendrían URLs amigables, páginas individuales de planes, etiquetas canónicas correctas y un sitemap actualizado. Después se daría seguimiento a la indexación, los clics, las impresiones y las posiciones para verificar la recuperación; los efectos de una corrección SEO pueden tardar en reflejarse.

**Para el rendimiento móvil**, se optimizarían los recursos que las mediciones identifiquen como problemáticos: imágenes y fuentes, carga diferida de contenido secundario, reducción de JavaScript innecesario, caché y solicitudes al servidor. Si el retraso proviene de la API o la base de datos, se revisarían las consultas y los recursos disponibles antes de aumentar infraestructura. Cada ajuste se comprobaría con nuevas mediciones bajo condiciones comparables y pruebas en dispositivos móviles.

Como medida preventiva, **las pruebas de certificación deberían representar lo mejor posible las condiciones de producción**. Antes de cada despliegue se verificarían versiones, contratos de API, configuraciones, migraciones y recorridos funcionales críticos. Esto permitiría detectar diferencias entre ambientes antes de afectar la captación de leads.

## 4. Opcional: ¿Cómo adaptarías este sistema si el volumen crece de 100 a 10.000 leads diarios?

El aumento representa **100 veces el volumen actual**. Sin embargo, antes de cambiar la arquitectura se ejecutarían pruebas de carga para medir el comportamiento del sistema en condiciones normales y durante picos de solicitudes, que pueden ser considerablemente mayores al promedio diario.

Con los resultados se optimizarían primero las consultas, los índices, la paginación y las conexiones de PostgreSQL. Si la API alcanzara sus límites, se aumentaría su capacidad y se considerarían varias instancias detrás de un balanceador. Las tareas que no requieren completarse antes de confirmar el registro —como notificaciones e integraciones externas— podrían procesarse mediante colas. También se aplicarían mecanismos para evitar leads duplicados ante reintentos y controles de solicitudes compatibles con múltiples instancias.

El escalamiento se acompañaría de monitoreo de errores, tiempos de respuesta, disponibilidad y consumo de recursos. **La evolución sería gradual y basada en mediciones**: no se propondría migrar directamente a microservicios o Kubernetes sin demostrar que la arquitectura actual de Next.js, Express y PostgreSQL ha dejado de responder a las necesidades del negocio.