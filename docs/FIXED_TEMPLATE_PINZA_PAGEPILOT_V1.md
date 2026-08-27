# Plantilla fija: Pinza PagePilot v1

Esta plantilla no es un editor visual ni un renderer genérico. El artefacto
visual fijo queda empaquetado dentro de
`extensions/tiendaiq-widgets/assets/tiq-pinzapilot-v1.js`, un tipo de asset
admitido por Shopify. El runtime no descarga ni regenera el HTML.
Su origen se identifica con el SHA-256:

`51f84ed4c4ccd6e107451fe16cfb079c448ed81f8fda5b40d26937ba097174a0`

## Regla de cambio

No se reemplaza el DOM, CSS, orden de secciones, galería, tarjetas ni barra
sticky al publicar un producto. La única variación autorizada es la inyección
de los slots de `tiendaiq/pinza-pagepilot@1`.

| Grupo | Fuente |
| --- | --- |
| título, descripción, precio, comparativo, variante | catálogo Shopify |
| galería | `product.media` mapeado por Media GID |
| bloques editoriales y FAQ | documento de página TiendaIQ validado |
| CTA | documento de página; añade la variante Shopify seleccionada |
| reseñas, UGC, políticas, logos, comparativas, cifras | sólo con atestación de compliance; sin ella se ocultan |
| medios de pago | no se infieren de una plantilla; no se muestran hasta contar con una fuente de checkout autorizada |

## Seguridad y procedencia

- El importador elimina scripts y URLs remotas de la fuente antes de generar el
  artefacto distribuible.
- El artefacto no contiene la copia comercial de origen como valor por defecto:
  muestra contenido neutral hasta que TiendaIQ lo sustituye con datos del
  merchant.
- Las imágenes se toman del catálogo del merchant y nunca de la CDN de una
  plantilla ajena.
- Cambiar la estructura requiere una nueva versión de template, una nueva huella
  y una revisión visual antes de su publicación.
