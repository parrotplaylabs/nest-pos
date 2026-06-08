const fs = require('fs');
const path = require('path');

const defaults = require('./defaults.json');

function env(key, fallback) {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : fallback;
}

function envInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envJson(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Invalid JSON in ${key}: ${err.message}. Using default.`);
    return fallback;
  }
}

function loadOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`Could not read ${filePath}: ${err.message}`);
    return null;
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      base[key] &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function buildConfig() {
  const fileOverride =
    loadOptionalJson(env('SHOP_CONFIG_FILE', path.join(__dirname, 'shop.json'))) || {};

  let config = deepMerge(defaults, fileOverride);

  config.shopName = env('SHOP_NAME', config.shopName);
  config.shopTagline = env('SHOP_TAGLINE', config.shopTagline);
  config.country = env('COUNTRY', config.country);
  config.locale = env('LOCALE', config.locale);
  config.contactNumber = env('CONTACT_NUMBER', config.contactNumber);
  config.defaultLowStockThreshold = envInt('DEFAULT_LOW_STOCK', config.defaultLowStockThreshold);
  config.defaultPaymentMethod = env('DEFAULT_PAYMENT_METHOD', config.defaultPaymentMethod);
  config.paymentReferencePlaceholder = env(
    'PAYMENT_REF_PLACEHOLDER',
    config.paymentReferencePlaceholder
  );
  config.estimatePaymentInfo = env('ESTIMATE_PAYMENT_INFO', config.estimatePaymentInfo);
  config.backupFilePrefix = env('BACKUP_FILE_PREFIX', config.backupFilePrefix);
  config.sampleCsv = env('SAMPLE_CSV', config.sampleCsv);

  config.currency = {
    symbol: env('CURRENCY_SYMBOL', config.currency.symbol),
    locale: env('CURRENCY_LOCALE', config.currency.locale),
    code: env('CURRENCY_CODE', config.currency.code),
  };

  config.paymentMethods = envJson('PAYMENT_METHODS', config.paymentMethods);
  config.pickupLocations = envJson('PICKUP_LOCATIONS', config.pickupLocations);

  if (process.env.PICKUP_HOURS_PLACEHOLDER) {
    config.pickup.hoursPlaceholder = process.env.PICKUP_HOURS_PLACEHOLDER;
  }
  if (process.env.PICKUP_NOTES_PLACEHOLDER) {
    config.pickup.notesPlaceholder = process.env.PICKUP_NOTES_PLACEHOLDER;
  }

  const shareFile = env('SHARE_TEMPLATES_FILE', '');
  if (shareFile) {
    const shareOverride = loadOptionalJson(shareFile);
    if (shareOverride) {
      config.shareTemplates = deepMerge(config.shareTemplates, shareOverride);
    }
  }

  return config;
}

const shopConfig = buildConfig();

function getPublicConfig() {
  return {
    shopName: shopConfig.shopName,
    shopTagline: shopConfig.shopTagline,
    country: shopConfig.country,
    locale: shopConfig.locale,
    currency: shopConfig.currency,
    contactNumber: shopConfig.contactNumber,
    defaultLowStockThreshold: shopConfig.defaultLowStockThreshold,
    defaultPaymentMethod: shopConfig.defaultPaymentMethod,
    paymentMethods: shopConfig.paymentMethods,
    paymentReferencePlaceholder: shopConfig.paymentReferencePlaceholder,
    estimatePaymentInfo: shopConfig.estimatePaymentInfo,
    pickupLocations: shopConfig.pickupLocations,
    pickup: shopConfig.pickup,
    labels: shopConfig.labels,
    sampleCsv: shopConfig.sampleCsv,
    shareTemplates: shopConfig.shareTemplates,
  };
}

function getDefaultPickupData() {
  return {
    contactNumber: shopConfig.contactNumber,
    locations: shopConfig.pickupLocations,
    schedules: {},
  };
}

module.exports = {
  shopConfig,
  getPublicConfig,
  getDefaultPickupData,
};
