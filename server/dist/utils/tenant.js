"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantStore = void 0;
exports.getTenantId = getTenantId;
exports.runWithTenant = runWithTenant;
const async_hooks_1 = require("async_hooks");
exports.tenantStore = new async_hooks_1.AsyncLocalStorage();
function getTenantId() {
    return exports.tenantStore.getStore();
}
function runWithTenant(tenantId, callback) {
    return exports.tenantStore.run(tenantId, callback);
}
