"use strict";

const crypto = require("crypto");

function createWebhookHandlers({ stores, billing, inbox, metrics }) {
  return Object.freeze({
    "app/uninstalled": {
      async run(event) {
        await stores.delete(event.shopDomain);
        await inbox.redactShop(event.lockedBy, event.shopDomain, event.id);
        metrics("desinstalacion", { tienda_hash: crypto.createHash("sha256").update(event.shopDomain).digest("hex").slice(0, 16) });
        return { deleted: true };
      }
    },

    "app_subscriptions/update": {
      async run(event) {
        const plan = await billing.update(event.shopDomain, event.payload);
        return { plan: plan || "unchanged" };
      }
    },

    "customers/data_request": {
      async run(event) {
        await inbox.recordPrivacy(event.lockedBy, {
          event,
          type: "customers_data_request",
          tenantReference: event.shopDomain,
          subjectHash: event.payload?.customer_ref || null
        });
        return { completed: true, storedCustomerData: false };
      }
    },

    "customers/redact": {
      async run(event) {
        await inbox.recordPrivacy(event.lockedBy, {
          event,
          type: "customers_redact",
          tenantReference: event.shopDomain,
          subjectHash: event.payload?.customer_ref || null
        });
        return { completed: true, storedCustomerData: false };
      }
    },

    "shop/redact": {
      async run(event) {
        const tenantHash = crypto.createHash("sha256").update(event.shopDomain).digest("hex");
        await stores.delete(event.shopDomain);
        await inbox.redactShop(event.lockedBy, event.shopDomain, event.id);
        await inbox.recordPrivacy(event.lockedBy, {
          event,
          type: "shop_redact",
          tenantReference: `redacted:${tenantHash}`,
          subjectHash: tenantHash
        });
        return { completed: true, deleted: true };
      }
    },

    "*": {
      async run(event) {
        metrics("webhook_ignorado", { topic: event.topic });
        return { ignored: true };
      }
    }
  });
}

module.exports = { createWebhookHandlers };
