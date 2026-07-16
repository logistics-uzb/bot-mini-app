const ALLOWED_ADMIN_USERNAMES = new Set(["umirzakov_mu", "mirxonjon"]);

const isAllowedAdminUser = (username) =>
  ALLOWED_ADMIN_USERNAMES.has(String(username || "").toLowerCase());

module.exports = { ALLOWED_ADMIN_USERNAMES, isAllowedAdminUser };
