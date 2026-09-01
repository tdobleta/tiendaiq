CREATE TABLE IF NOT EXISTS public.tiendas (
  dominio     TEXT PRIMARY KEY,
  datos       JSONB NOT NULL,
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.paginas (
  tienda      TEXT NOT NULL,
  id          TEXT NOT NULL,
  datos       JSONB NOT NULL,
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tienda, id)
);

CREATE INDEX IF NOT EXISTS paginas_tienda_actualizada_idx
  ON public.paginas (tienda, actualizada DESC);

CREATE TABLE IF NOT EXISTS public.estados_oauth (
  estado TEXT PRIMARY KEY,
  tienda TEXT NOT NULL,
  vence  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS estados_oauth_vence_idx
  ON public.estados_oauth (vence);
