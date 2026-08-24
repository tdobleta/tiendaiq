"use strict";

function createAppRegistrationRepository(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("Se requiere un pool PostgreSQL");

  return Object.freeze({
    async assert(registrationId) {
      await pool.query("SELECT control_plane.assert_app_registration($1)", [registrationId]);
      return true;
    },
    async bind(registrationId) {
      await pool.query("SELECT control_plane.bind_app_registration($1)", [registrationId]);
      return true;
    }
  });
}

module.exports = { createAppRegistrationRepository };
