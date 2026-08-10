-- DELETE ... RETURNING y los predicados de borrado necesitan privilegio SELECT
-- sobre sus columnas. No existe una policy FOR SELECT, por lo que una consulta
-- ordinaria del runtime sigue viendo cero filas.

GRANT SELECT (estado, tienda, vence) ON public.estados_oauth
TO tiendaiq_web, tiendaiq_worker;
