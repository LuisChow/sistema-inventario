/**
 * Validación de entradas para los endpoints del backend.
 *
 * Uso:
 *   const { validate } = require('./lib/validators');
 *   const errores = validate(req.body, schemaRepuesto);
 *   if (errores) return res.status(400).json({ error: errores.join('; ') });
 */

const EMPTY_VALUES = new Set([null, undefined, '']);

function isEmpty(value) {
  return EMPTY_VALUES.has(value);
}

/**
 * Valida un objeto contra un schema. Devuelve `null` si todo está bien,
 * o un array de mensajes de error legibles para humanos.
 *
 * Schema example:
 *   {
 *     codigo:       { type: 'string', required: true, minLength: 1, maxLength: 50 },
 *     cantidad:     { type: 'number', required: true, integer: true, min: 0 },
 *     tipo:         { type: 'string', required: true, enum: ['Entrada','Salida'] },
 *     precioCompra: { type: 'number', required: true, min: 0 },
 *     descripcion:  { type: 'string', required: false, maxLength: 500 }
 *   }
 */
function validate(data, schema) {
  if (!data || typeof data !== 'object') {
    return ['Body inválido o vacío'];
  }

  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (isEmpty(value)) {
      if (rules.required) errors.push(`${field}: campo requerido`);
      continue; // opcional vacío → ok
    }

    if (rules.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${field}: debe ser texto`);
        continue;
      }
      const trimmedLen = value.trim().length;
      if (rules.minLength !== undefined && trimmedLen < rules.minLength) {
        errors.push(`${field}: mínimo ${rules.minLength} caracter(es)`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`${field}: máximo ${rules.maxLength} caracter(es)`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field}: debe ser uno de [${rules.enum.join(', ')}]`);
      }
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${field}: formato inválido`);
      }
    } else if (rules.type === 'number') {
      const n = Number(value);
      if (Number.isNaN(n) || !Number.isFinite(n)) {
        errors.push(`${field}: debe ser número válido`);
        continue;
      }
      if (rules.integer && !Number.isInteger(n)) {
        errors.push(`${field}: debe ser número entero`);
      }
      if (rules.min !== undefined && n < rules.min) {
        errors.push(`${field}: mínimo ${rules.min}`);
      }
      if (rules.max !== undefined && n > rules.max) {
        errors.push(`${field}: máximo ${rules.max}`);
      }
    } else if (rules.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${field}: debe ser una lista`);
        continue;
      }
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push(`${field}: mínimo ${rules.minLength} elemento(s)`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`${field}: máximo ${rules.maxLength} elemento(s)`);
      }
      if (rules.itemSchema) {
        value.forEach((item, idx) => {
          const itemErrors = validate(item, rules.itemSchema);
          if (itemErrors) {
            itemErrors.forEach(e => errors.push(`${field}[${idx}].${e}`));
          }
        });
      }
    }
  }

  return errors.length > 0 ? errors : null;
}

// === SCHEMAS REUTILIZABLES ===

const TIPOS_MOVIMIENTO = ['Entrada', 'Salida', 'Modificacion', 'Anulacion', 'Abono'];
const METODOS_PAGO = ['Contado', 'Credito'];
const ESTADOS_PAGO = ['Pagado', 'Abono', 'Pendiente'];

const schemaRepuesto = {
  codigo:         { type: 'string', required: true, minLength: 1, maxLength: 50 },
  nombre:         { type: 'string', required: true, minLength: 1, maxLength: 200 },
  categoria:      { type: 'string', required: true, minLength: 1, maxLength: 100 },
  cantidad:       { type: 'number', required: true, integer: true, min: 0 },
  precioCompra:   { type: 'number', required: true, min: 0 },
  precioVenta:    { type: 'number', required: true, min: 0 },
  precioCompraBs: { type: 'number', required: false, min: 0 }
};

const schemaMovimiento = {
  fecha:            { type: 'string', required: true, maxLength: 100 },
  codigoProducto:   { type: 'string', required: true, minLength: 1, maxLength: 50 },
  nombreProducto:   { type: 'string', required: true, minLength: 1, maxLength: 200 },
  tipo:             { type: 'string', required: true, enum: TIPOS_MOVIMIENTO },
  cantidad:         { type: 'number', required: true, integer: true, min: 0 },
  descripcion:      { type: 'string', required: false, maxLength: 500 },
  valorTotalUsd:    { type: 'number', required: false, min: 0 },
  gananciaUsd:      { type: 'number', required: false },
  valorTotalBs:     { type: 'number', required: false, min: 0 },
  gananciaBs:       { type: 'number', required: false },
  facturaId:        { type: 'string', required: false, maxLength: 50 },
  clienteNombre:    { type: 'string', required: false, maxLength: 200 },
  clienteDocumento: { type: 'string', required: false, maxLength: 50 },
  clienteTelefono:  { type: 'string', required: false, maxLength: 50 },
  clienteDireccion: { type: 'string', required: false, maxLength: 500 },
  metodoPago:       { type: 'string', required: false, enum: METODOS_PAGO },
  estadoPago:       { type: 'string', required: false, enum: ESTADOS_PAGO },
  // JSON serializado con { old: {...}, new: {...} } para revertir ediciones
  metadatos:        { type: 'string', required: false, maxLength: 4000 }
};

const schemaCategoria = {
  nombre: { type: 'string', required: true, minLength: 1, maxLength: 100 }
};

const schemaCategoriaRename = {
  nombreNuevo: { type: 'string', required: true, minLength: 1, maxLength: 100 }
};

const schemaItemVenta = {
  codigo:         { type: 'string', required: true, minLength: 1, maxLength: 50 },
  nombreProducto: { type: 'string', required: true, minLength: 1, maxLength: 200 },
  cantidad:       { type: 'number', required: true, integer: true, min: 1 },
  valorTotalUsd:  { type: 'number', required: true, min: 0 },
  gananciaUsd:    { type: 'number', required: true },
  valorTotalBs:   { type: 'number', required: false, min: 0 },
  gananciaBs:     { type: 'number', required: false }
};

const schemaVenta = {
  facturaId:        { type: 'string', required: true, minLength: 1, maxLength: 50 },
  fecha:            { type: 'string', required: true, maxLength: 100 },
  items:            { type: 'array', required: true, minLength: 1, maxLength: 500, itemSchema: schemaItemVenta },
  clienteNombre:    { type: 'string', required: true, minLength: 1, maxLength: 200 },
  clienteDocumento: { type: 'string', required: false, maxLength: 50 },
  clienteTelefono:  { type: 'string', required: false, maxLength: 50 },
  clienteDireccion: { type: 'string', required: false, maxLength: 500 },
  metodoPago:       { type: 'string', required: true, enum: METODOS_PAGO },
  pagoInicial:      { type: 'number', required: true, min: 0 },
  tasaCambio:       { type: 'number', required: false, min: 0 }
};

// Datos de la empresa que aparecen en facturas impresas y configuración general.
const schemaConfiguracion = {
  empresa_nombre:    { type: 'string', required: false, maxLength: 200 },
  empresa_rif:       { type: 'string', required: false, maxLength: 50 },
  empresa_direccion: { type: 'string', required: false, maxLength: 500 },
  empresa_telefono:  { type: 'string', required: false, maxLength: 100 },
  empresa_email:     { type: 'string', required: false, maxLength: 200 },
  empresa_logo:      { type: 'string', required: false, maxLength: 800000 }, // ~600KB binaria en base64
  empresa_mensaje:   { type: 'string', required: false, maxLength: 500 },
  moneda_principal:  { type: 'string', required: false, maxLength: 10 }
};

const schemaRestore = {
  nombre: { type: 'string', required: true, minLength: 1, maxLength: 200, pattern: /^[a-zA-Z0-9._-]+\.db$/ }
};

// Cada cambio en la tasa de cambio se guarda como una nueva fila para
// mantener un historial auditable de las tasas usadas a lo largo del tiempo.
const schemaTasaCambio = {
  valor: { type: 'number', required: true, min: 0, max: 1000000 }
};

const schemaCliente = {
  nombre:    { type: 'string', required: true, minLength: 1, maxLength: 200 },
  documento: { type: 'string', required: false, maxLength: 50 },
  telefono:  { type: 'string', required: false, maxLength: 50 },
  direccion: { type: 'string', required: false, maxLength: 500 },
  email:     { type: 'string', required: false, maxLength: 200 }
};

module.exports = {
  validate,
  schemaRepuesto,
  schemaMovimiento,
  schemaCategoria,
  schemaCategoriaRename,
  schemaVenta,
  schemaConfiguracion,
  schemaRestore,
  schemaTasaCambio,
  schemaCliente,
  TIPOS_MOVIMIENTO,
  METODOS_PAGO,
  ESTADOS_PAGO
};
