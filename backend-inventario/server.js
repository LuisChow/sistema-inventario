const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');

const {
  validate,
  schemaRepuesto,
  schemaMovimiento,
  schemaCategoria,
  schemaCategoriaRename,
  schemaVenta,
  schemaConfiguracion,
  schemaRestore,
  schemaTasaCambio,
  schemaCliente
} = require('./lib/validators');
const { wrap } = require('./lib/db');

const app = express();
const PORT = 3000;

// ====== MIDDLEWARE ======
// CORS limitado a orígenes locales (Electron + dev server de Angular)
app.use(cors({
  origin: (origin, cb) => {
    // Sin origin = misma origin (Electron carga http://localhost:3000 directo)
    if (!origin) return cb(null, true);
    const ok = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'null' || origin.startsWith('file://');
    cb(ok ? null : new Error('Origen no permitido'), ok);
  }
}));

// Limite razonable para evitar payloads gigantes
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Manejador para JSON malformado
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalido en el body' });
  }
  next(err);
});

// ====== BASE DE DATOS ======
const carpetaSegura = path.join(os.homedir(), 'Documents', 'Inventario Chow');
const carpetaBackups = path.join(carpetaSegura, 'backups');
if (!fs.existsSync(carpetaSegura)) {
  fs.mkdirSync(carpetaSegura, { recursive: true });
}
if (!fs.existsSync(carpetaBackups)) {
  fs.mkdirSync(carpetaBackups, { recursive: true });
}
const rutaSegura = path.join(carpetaSegura, 'inventario.db');
const markerRestore = path.join(carpetaSegura, '.restore-on-startup');

// Si existe un marcador de restauracion, aplicamos el respaldo ANTES de abrir la BD.
// Esto evita conflictos con SQLite (que mantendria el archivo bloqueado).
if (fs.existsSync(markerRestore)) {
  try {
    const nombre = fs.readFileSync(markerRestore, 'utf8').trim();
    const fuente = path.join(carpetaBackups, nombre);
    if (fs.existsSync(fuente)) {
      fs.copyFileSync(fuente, rutaSegura);
      console.log('Base de datos restaurada desde respaldo:', nombre);
    } else {
      console.warn('Respaldo no encontrado:', nombre);
    }
  } catch (err) {
    console.error('Error al restaurar respaldo:', err);
  } finally {
    try { fs.unlinkSync(markerRestore); } catch (_) {}
  }
}

const db = new sqlite3.Database(rutaSegura, (err) => {
  if (err) {
    console.error('Error al abrir la BD:', err.message);
  } else {
    console.log('Conectado a SQLite en:', rutaSegura);
    crearTablas();
    // Respaldo automático diario: si todavía no hay un respaldo de hoy, lo crea.
    // Damos un pequeño delay para que las tablas y migraciones se terminen de
    // aplicar antes de ejecutar VACUUM INTO.
    setTimeout(() => respaldoDiarioAutomatico(), 2000);
  }
});

// Habilita claves foraneas y modo WAL (mejor concurrencia)
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');
});

const dbp = wrap(db);

function crearTablas() {
  db.run(`CREATE TABLE IF NOT EXISTS repuestos (
    codigo TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL,
    cantidad INTEGER DEFAULT 0,
    precioCompra REAL DEFAULT 0.0,
    precioVenta REAL DEFAULT 0.0,
    precioCompraBs REAL DEFAULT 0.0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    codigoProducto TEXT NOT NULL,
    nombreProducto TEXT NOT NULL,
    tipo TEXT NOT NULL,
    cantidad INTEGER DEFAULT 0,
    descripcion TEXT,
    valorTotalUsd REAL DEFAULT 0.0,
    gananciaUsd REAL DEFAULT 0.0,
    valorTotalBs REAL DEFAULT 0.0,
    gananciaBs REAL DEFAULT 0.0,
    facturaId TEXT,
    clienteNombre TEXT,
    clienteDocumento TEXT,
    clienteTelefono TEXT,
    clienteDireccion TEXT,
    metodoPago TEXT DEFAULT 'Contado',
    estadoPago TEXT DEFAULT 'Pagado'
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_mov_factura ON movimientos(facturaId)');
  db.run('CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos(fecha)');
  db.run('CREATE INDEX IF NOT EXISTS idx_mov_codigo ON movimientos(codigoProducto)');

  db.run(`CREATE TABLE IF NOT EXISTS categorias (nombre TEXT PRIMARY KEY)`, (err) => {
    if (!err) {
      db.get('SELECT COUNT(*) AS count FROM categorias', (err, row) => {
        if (row && row.count === 0) {
          db.run("INSERT INTO categorias (nombre) VALUES (?)", ['General']);
        }
      });
    }
  });

  // Tabla key-value para configuracion (datos de la empresa, tasa por defecto, etc.)
  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT
  )`);

  // Historial de tasas de cambio (USD -> Bs). Cada cambio crea una nueva fila
  // para tener auditoria completa.
  db.run(`CREATE TABLE IF NOT EXISTS tasas_cambio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    valor REAL NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_tasas_fecha ON tasas_cambio(fecha)');

  // Clientes deduplicados. Antes la info del cliente vivia repetida en cada
  // movimiento; ahora cada cliente tiene su fila y los movimientos referencian
  // por cliente_id. Los movimientos viejos mantienen sus campos inline para
  // que sigan siendo legibles.
  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    documento TEXT,
    telefono TEXT,
    direccion TEXT,
    email TEXT,
    fechaCreacion TEXT NOT NULL,
    fechaActualizacion TEXT NOT NULL
  )`);
  // Indice unico parcial: documento debe ser unico SOLO cuando esta presente
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_doc
          ON clientes(documento)
          WHERE documento IS NOT NULL AND documento != ''`);
  db.run('CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre)');

  // Migracion: agregar columna cliente_id a movimientos si todavia no existe.
  asegurarColumna('movimientos', 'cliente_id', 'INTEGER').catch(err =>
    console.error('Migracion movimientos.cliente_id fallida:', err)
  );
  // Migracion: agregar columna metadatos para guardar JSON con old/new al editar.
  // Permite que la anulacion de una Modificacion (o un Ajuste con cambio de precio)
  // revierta correctamente los campos del producto.
  asegurarColumna('movimientos', 'metadatos', 'TEXT').catch(err =>
    console.error('Migracion movimientos.metadatos fallida:', err)
  );
}

/**
 * Helper de migracion: agrega una columna a una tabla solo si todavia no existe.
 * SQLite no tiene IF NOT EXISTS para columnas, asi que primero consultamos
 * PRAGMA table_info.
 */
async function asegurarColumna(tabla, columna, tipo) {
  const cols = await dbp.all(`PRAGMA table_info(${tabla})`);
  if (!cols.some(c => c.name === columna)) {
    await dbp.run(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
    console.log(`Migracion aplicada: ${tabla}.${columna}`);
  }
}

/**
 * Crea o actualiza un cliente. Si tiene `documento`, busca por documento;
 * si no, intenta por (nombre + sin documento). Devuelve el cliente final
 * con su id. Se usa desde POST /api/clientes y desde POST /api/ventas.
 */
async function upsertCliente(data) {
  const nombre = (data.nombre || '').trim();
  if (!nombre) throw new Error('Nombre de cliente requerido');
  const documento = (data.documento || '').trim();
  const telefono = (data.telefono || '').trim();
  const direccion = (data.direccion || '').trim();
  const email = (data.email || '').trim();
  const ahora = new Date().toISOString();

  let existente = null;
  if (documento) {
    existente = await dbp.get('SELECT * FROM clientes WHERE documento = ?', [documento]);
  } else {
    existente = await dbp.get(
      `SELECT * FROM clientes
       WHERE (documento IS NULL OR documento = '') AND LOWER(nombre) = LOWER(?)
       LIMIT 1`,
      [nombre]
    );
  }

  if (existente) {
    const cambio = existente.nombre !== nombre
                || (existente.telefono || '') !== telefono
                || (existente.direccion || '') !== direccion
                || (existente.email || '') !== email;
    if (cambio) {
      await dbp.run(
        `UPDATE clientes SET nombre = ?, telefono = ?, direccion = ?, email = ?, fechaActualizacion = ?
         WHERE id = ?`,
        [nombre, telefono, direccion, email, ahora, existente.id]
      );
    }
    return {
      id: existente.id,
      nombre,
      documento: existente.documento || documento,
      telefono,
      direccion,
      email,
      fechaCreacion: existente.fechaCreacion,
      fechaActualizacion: ahora
    };
  }

  const r = await dbp.run(
    `INSERT INTO clientes (nombre, documento, telefono, direccion, email, fechaCreacion, fechaActualizacion)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nombre, documento || null, telefono, direccion, email, ahora, ahora]
  );
  return {
    id: r.lastID,
    nombre,
    documento: documento || null,
    telefono, direccion, email,
    fechaCreacion: ahora,
    fechaActualizacion: ahora
  };
}

// ====== HELPERS DE RESPUESTA ======
function badRequest(res, errors) {
  return res.status(400).json({ error: Array.isArray(errors) ? errors.join('; ') : errors });
}

function serverError(res, err, contexto) {
  console.error(`Error en ${contexto}:`, err);
  return res.status(500).json({ error: err && err.message ? err.message : `Error en ${contexto}` });
}

// ====== RUTAS REPUESTOS ======
app.get('/api/repuestos', async (req, res) => {
  try {
    const rows = await dbp.all('SELECT * FROM repuestos');
    res.json(rows);
  } catch (err) { serverError(res, err, 'listar repuestos'); }
});

app.post('/api/repuestos', async (req, res) => {
  const errors = validate(req.body, schemaRepuesto);
  if (errors) return badRequest(res, errors);

  const { codigo, nombre, categoria, cantidad, precioCompra, precioVenta, precioCompraBs } = req.body;

  try {
    const existente = await dbp.get('SELECT codigo FROM repuestos WHERE codigo = ?', [codigo.trim()]);
    if (existente) return res.status(409).json({ error: `El codigo "${codigo}" ya existe.` });

    await dbp.run(
      `INSERT INTO repuestos (codigo, nombre, categoria, cantidad, precioCompra, precioVenta, precioCompraBs)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo.trim(), nombre.trim(), categoria.trim(), cantidad, precioCompra, precioVenta, precioCompraBs || 0]
    );
    res.json({ mensaje: 'Guardado' });
  } catch (err) { serverError(res, err, 'guardar repuesto'); }
});

app.put('/api/repuestos/:codigo', async (req, res) => {
  if (!req.params.codigo || req.params.codigo.length > 50) {
    return badRequest(res, 'codigo en URL invalido');
  }
  const errors = validate(req.body, schemaRepuesto);
  if (errors) return badRequest(res, errors);

  const { nombre, categoria, cantidad, precioCompra, precioVenta, precioCompraBs } = req.body;

  try {
    const result = await dbp.run(
      `UPDATE repuestos SET nombre = ?, categoria = ?, cantidad = ?, precioCompra = ?, precioVenta = ?, precioCompraBs = ?
       WHERE codigo = ?`,
      [nombre.trim(), categoria.trim(), cantidad, precioCompra, precioVenta, precioCompraBs || 0, req.params.codigo]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Repuesto no encontrado' });
    res.json({ mensaje: 'Actualizado' });
  } catch (err) { serverError(res, err, 'actualizar repuesto'); }
});

app.delete('/api/repuestos/:codigo', async (req, res) => {
  if (!req.params.codigo) return badRequest(res, 'codigo requerido');
  const codigo = req.params.codigo;

  try {
    // Chequeo de bloqueo: ventas reales que NO hayan sido anuladas.
    // Una venta esta anulada si existe un movimiento de tipo 'Anulacion'
    // con el mismo facturaId. Esas no cuentan como historial financiero
    // que debamos proteger.
    const ventasActivas = await dbp.get(
      `SELECT COUNT(*) AS c FROM movimientos m1
       WHERE m1.codigoProducto = ?
         AND m1.tipo = 'Salida'
         AND m1.facturaId LIKE 'FACT-%'
         AND NOT EXISTS (
           SELECT 1 FROM movimientos m2
           WHERE m2.facturaId = m1.facturaId AND m2.tipo = 'Anulacion'
         )`,
      [codigo]
    );

    if (ventasActivas && ventasActivas.c > 0) {
      return res.status(409).json({
        error: `Este producto tiene ${ventasActivas.c} venta(s) activa(s). No se puede eliminar sin perder tu historial financiero. Si ya no querés venderlo, ponelo en stock 0 desde el botón de editar.`
      });
    }

    // Sin ventas activas: cascade delete completo.
    // Pasos:
    //   1. Tomar nota de las facturas en las que aparece este producto.
    //   2. Borrar el producto.
    //   3. Borrar todos los movimientos cuyo codigoProducto sea el del producto
    //      (registros iniciales INIT-, ajustes AJUS-, modificaciones MOD-,
    //      salidas anuladas, averias, etc).
    //   4. Para cada factura tocada, si ya no quedan salidas, limpiar tambien
    //      sus Abonos y Anulaciones huerfanas (de lo contrario quedarian
    //      flotando sin lineas de venta en el historial).
    let cascadeBorrados = 0;
    let facturasLimpiadas = 0;
    await dbp.transaction(async () => {
      const facturasAfectadas = await dbp.all(
        `SELECT DISTINCT facturaId FROM movimientos
         WHERE codigoProducto = ? AND facturaId IS NOT NULL AND facturaId != ''`,
        [codigo]
      );

      const r = await dbp.run('DELETE FROM repuestos WHERE codigo = ?', [codigo]);
      if (r.changes === 0) {
        throw new Error('Repuesto no encontrado');
      }

      const m = await dbp.run('DELETE FROM movimientos WHERE codigoProducto = ?', [codigo]);
      cascadeBorrados = m.changes;

      for (const f of facturasAfectadas) {
        const facturaId = f.facturaId;
        if (!facturaId || !facturaId.startsWith('FACT-')) continue; // sólo limpiamos huérfanos de ventas
        const otrasSalidas = await dbp.get(
          `SELECT COUNT(*) AS c FROM movimientos
           WHERE facturaId = ? AND tipo = 'Salida'`,
          [facturaId]
        );
        if (otrasSalidas && otrasSalidas.c === 0) {
          const huerfanos = await dbp.run(
            `DELETE FROM movimientos
             WHERE facturaId = ? AND tipo IN ('Abono', 'Anulacion')`,
            [facturaId]
          );
          cascadeBorrados += huerfanos.changes;
          facturasLimpiadas++;
        }
      }
    });

    res.json({
      mensaje: 'Eliminado',
      movimientosBorrados: cascadeBorrados,
      facturasLimpiadas
    });
  } catch (err) {
    if (err && err.message === 'Repuesto no encontrado') {
      return res.status(404).json({ error: err.message });
    }
    serverError(res, err, 'eliminar repuesto');
  }
});

// ====== RUTAS MOVIMIENTOS ======
app.get('/api/movimientos', async (req, res) => {
  try {
    const rows = await dbp.all('SELECT * FROM movimientos ORDER BY fecha DESC');
    res.json(rows);
  } catch (err) { serverError(res, err, 'listar movimientos'); }
});

app.post('/api/movimientos', async (req, res) => {
  const errors = validate(req.body, schemaMovimiento);
  if (errors) return badRequest(res, errors);

  const m = req.body;
  try {
    const result = await dbp.run(
      `INSERT INTO movimientos
        (fecha, codigoProducto, nombreProducto, tipo, cantidad, descripcion,
         valorTotalUsd, gananciaUsd, valorTotalBs, gananciaBs,
         facturaId, clienteNombre, clienteDocumento, clienteTelefono, clienteDireccion,
         metodoPago, estadoPago, metadatos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.fecha, m.codigoProducto, m.nombreProducto, m.tipo, m.cantidad, m.descripcion || '',
        m.valorTotalUsd || 0, m.gananciaUsd || 0, m.valorTotalBs || 0, m.gananciaBs || 0,
        m.facturaId || null, m.clienteNombre || null, m.clienteDocumento || null,
        m.clienteTelefono || null, m.clienteDireccion || null,
        m.metodoPago || 'Contado', m.estadoPago || 'Pagado',
        m.metadatos || null
      ]
    );
    res.json({ mensaje: 'Registrado', id: result.lastID });
  } catch (err) { serverError(res, err, 'registrar movimiento'); }
});

app.delete('/api/movimientos/factura/:facturaId', async (req, res) => {
  if (!req.params.facturaId) return badRequest(res, 'facturaId requerido');
  try {
    const result = await dbp.run('DELETE FROM movimientos WHERE facturaId = ?', [req.params.facturaId]);
    res.json({ mensaje: 'Factura revertida', borrados: result.changes });
  } catch (err) { serverError(res, err, 'revertir factura'); }
});

// ====== VENTA ATOMICA ======
app.post('/api/ventas', async (req, res) => {
  const errors = validate(req.body, schemaVenta);
  if (errors) return badRequest(res, errors);

  const venta = req.body;

  try {
    let clienteId = null;

    await dbp.transaction(async () => {
      // 0. Upsert del cliente
      try {
        const cliente = await upsertCliente({
          nombre: venta.clienteNombre,
          documento: venta.clienteDocumento,
          telefono: venta.clienteTelefono,
          direccion: venta.clienteDireccion
        });
        clienteId = cliente.id;
      } catch (e) {
        // Si falla el upsert (p.ej. documento duplicado raro), seguimos sin cliente_id.
        console.warn('Upsert cliente fallido, continuando sin cliente_id:', e.message);
        clienteId = null;
      }

      // 1. Verificar stock para todos los items
      for (const item of venta.items) {
        const producto = await dbp.get('SELECT cantidad, nombre FROM repuestos WHERE codigo = ?', [item.codigo]);
        if (!producto) {
          throw new Error(`Producto "${item.codigo}" no existe`);
        }
        if (producto.cantidad < item.cantidad) {
          throw new Error(`Stock insuficiente para "${producto.nombre}" (disponible: ${producto.cantidad}, solicitado: ${item.cantidad})`);
        }
      }

      const totalUsd = venta.items.reduce((acc, it) => acc + (Number(it.valorTotalUsd) || 0), 0);
      const estadoPago = venta.pagoInicial > 0
        ? (venta.pagoInicial >= totalUsd ? 'Pagado' : 'Abono')
        : 'Pendiente';

      // 2. Descontar stock e insertar movimientos
      for (const item of venta.items) {
        await dbp.run(
          'UPDATE repuestos SET cantidad = cantidad - ? WHERE codigo = ?',
          [item.cantidad, item.codigo]
        );
        await dbp.run(
          `INSERT INTO movimientos
            (fecha, codigoProducto, nombreProducto, tipo, cantidad, descripcion,
             valorTotalUsd, gananciaUsd, valorTotalBs, gananciaBs,
             facturaId, clienteNombre, clienteDocumento, clienteTelefono, clienteDireccion,
             metodoPago, estadoPago, cliente_id)
           VALUES (?, ?, ?, 'Salida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            venta.fecha, item.codigo, item.nombreProducto, item.cantidad, 'Venta mostrador',
            item.valorTotalUsd || 0, item.gananciaUsd || 0,
            item.valorTotalBs || 0, item.gananciaBs || 0,
            venta.facturaId,
            venta.clienteNombre, venta.clienteDocumento || null,
            venta.clienteTelefono || null, venta.clienteDireccion || null,
            venta.metodoPago, estadoPago, clienteId
          ]
        );
      }

      // 3. Registrar pago inicial como Abono
      if (venta.pagoInicial > 0) {
        const tasa = venta.tasaCambio || 0;
        await dbp.run(
          `INSERT INTO movimientos
            (fecha, codigoProducto, nombreProducto, tipo, cantidad, descripcion,
             valorTotalUsd, gananciaUsd, valorTotalBs, gananciaBs,
             facturaId, clienteNombre, clienteDocumento, clienteTelefono, clienteDireccion,
             metodoPago, estadoPago, cliente_id)
           VALUES (?, 'PAGO', 'Abono a Factura', 'Abono', 1, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, 'Abono', ?)`,
          [
            venta.fecha,
            venta.metodoPago === 'Credito' ? 'Pago Inicial' : 'Pago de Contado',
            venta.pagoInicial,
            venta.pagoInicial * tasa,
            venta.facturaId,
            venta.clienteNombre, venta.clienteDocumento || null,
            venta.clienteTelefono || null, venta.clienteDireccion || null,
            venta.metodoPago, clienteId
          ]
        );
      }
    });

    res.json({ mensaje: 'Venta procesada', facturaId: venta.facturaId, clienteId });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Error al procesar venta';
    if (msg.includes('Stock insuficiente') || msg.includes('no existe')) {
      return res.status(400).json({ error: msg });
    }
    serverError(res, err, 'procesar venta');
  }
});

// ====== RUTAS CATEGORIAS ======
app.get('/api/categorias', async (req, res) => {
  try {
    const rows = await dbp.all('SELECT nombre FROM categorias ORDER BY nombre');
    res.json(rows.map(r => r.nombre));
  } catch (err) { serverError(res, err, 'listar categorias'); }
});

app.post('/api/categorias', async (req, res) => {
  const errors = validate(req.body, schemaCategoria);
  if (errors) return badRequest(res, errors);

  try {
    await dbp.run('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)', [req.body.nombre.trim()]);
    res.json({ mensaje: 'Guardada' });
  } catch (err) { serverError(res, err, 'guardar categoria'); }
});

app.put('/api/categorias/:nombreViejo', async (req, res) => {
  if (!req.params.nombreViejo) return badRequest(res, 'nombreViejo requerido');
  const errors = validate(req.body, schemaCategoriaRename);
  if (errors) return badRequest(res, errors);

  const { nombreViejo } = req.params;
  const nombreNuevo = req.body.nombreNuevo.trim();

  try {
    await dbp.transaction(async () => {
      if (nombreNuevo.toLowerCase() !== nombreViejo.toLowerCase()) {
        const existente = await dbp.get('SELECT nombre FROM categorias WHERE nombre = ?', [nombreNuevo]);
        if (existente) throw new Error(`La categoria "${nombreNuevo}" ya existe.`);
      }
      await dbp.run('UPDATE categorias SET nombre = ? WHERE nombre = ?', [nombreNuevo, nombreViejo]);
      await dbp.run('UPDATE repuestos SET categoria = ? WHERE categoria = ?', [nombreNuevo, nombreViejo]);
    });
    res.json({ mensaje: 'Categoria y repuestos actualizados' });
  } catch (err) {
    if (err.message && err.message.includes('ya existe')) {
      return res.status(409).json({ error: err.message });
    }
    serverError(res, err, 'renombrar categoria');
  }
});

app.delete('/api/categorias/:nombre', async (req, res) => {
  if (!req.params.nombre) return badRequest(res, 'nombre requerido');
  try {
    // Proteccion: no permitir borrar la ultima categoria — el sistema necesita
    // siempre al menos una para poder crear productos nuevos.
    const total = await dbp.get('SELECT COUNT(*) AS c FROM categorias');
    if (total && total.c <= 1) {
      return res.status(409).json({ error: 'No se puede eliminar la única categoría existente.' });
    }
    const enUso = await dbp.get('SELECT COUNT(*) AS c FROM repuestos WHERE categoria = ?', [req.params.nombre]);
    if (enUso && enUso.c > 0) {
      return res.status(409).json({ error: `Hay ${enUso.c} producto(s) usando esta categoria.` });
    }
    const result = await dbp.run('DELETE FROM categorias WHERE nombre = ?', [req.params.nombre]);
    if (result.changes === 0) return res.status(404).json({ error: 'Categoria no encontrada' });
    res.json({ mensaje: 'Eliminada' });
  } catch (err) { serverError(res, err, 'eliminar categoria'); }
});

// ====== CONFIGURACION DE LA EMPRESA ======
app.get('/api/configuracion', async (req, res) => {
  try {
    const rows = await dbp.all('SELECT clave, valor FROM configuracion');
    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) { serverError(res, err, 'leer configuracion'); }
});

app.put('/api/configuracion', async (req, res) => {
  const errors = validate(req.body, schemaConfiguracion);
  if (errors) return badRequest(res, errors);

  try {
    await dbp.transaction(async () => {
      for (const [clave, valor] of Object.entries(req.body)) {
        if (valor === null || valor === undefined || valor === '') {
          await dbp.run('DELETE FROM configuracion WHERE clave = ?', [clave]);
        } else {
          await dbp.run(
            `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
            [clave, String(valor)]
          );
        }
      }
    });
    res.json({ mensaje: 'Configuracion guardada' });
  } catch (err) { serverError(res, err, 'guardar configuracion'); }
});

// ====== TASAS DE CAMBIO ======
app.get('/api/tasas', async (req, res) => {
  try {
    const rows = await dbp.all('SELECT id, fecha, valor FROM tasas_cambio ORDER BY id DESC LIMIT 200');
    res.json(rows);
  } catch (err) { serverError(res, err, 'listar tasas'); }
});

app.get('/api/tasas/latest', async (req, res) => {
  try {
    const row = await dbp.get('SELECT id, fecha, valor FROM tasas_cambio ORDER BY id DESC LIMIT 1');
    res.json(row || null);
  } catch (err) { serverError(res, err, 'obtener tasa actual'); }
});

app.post('/api/tasas', async (req, res) => {
  const errors = validate(req.body, schemaTasaCambio);
  if (errors) return badRequest(res, errors);
  try {
    const fecha = new Date().toISOString();
    const result = await dbp.run(
      'INSERT INTO tasas_cambio (fecha, valor) VALUES (?, ?)',
      [fecha, req.body.valor]
    );
    res.json({ mensaje: 'Tasa registrada', id: result.lastID, fecha, valor: req.body.valor });
  } catch (err) { serverError(res, err, 'registrar tasa'); }
});

// ====== CLIENTES ======
app.get('/api/clientes', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = await dbp.all(
        `SELECT * FROM clientes
         WHERE nombre LIKE ? OR documento LIKE ?
         ORDER BY nombre LIMIT 50`,
        [like, like]
      );
    } else {
      rows = await dbp.all('SELECT * FROM clientes ORDER BY nombre LIMIT 500');
    }
    res.json(rows);
  } catch (err) { serverError(res, err, 'listar clientes'); }
});

app.get('/api/clientes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id invalido');
    const row = await dbp.get('SELECT * FROM clientes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(row);
  } catch (err) { serverError(res, err, 'obtener cliente'); }
});

app.post('/api/clientes', async (req, res) => {
  const errors = validate(req.body, schemaCliente);
  if (errors) return badRequest(res, errors);
  try {
    const cliente = await upsertCliente(req.body);
    res.json(cliente);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese documento.' });
    }
    serverError(res, err, 'guardar cliente');
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  const errors = validate(req.body, schemaCliente);
  if (errors) return badRequest(res, errors);
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id invalido');
    const ahora = new Date().toISOString();
    const { nombre, documento, telefono, direccion, email } = req.body;
    const r = await dbp.run(
      `UPDATE clientes
       SET nombre = ?, documento = ?, telefono = ?, direccion = ?, email = ?, fechaActualizacion = ?
       WHERE id = ?`,
      [nombre.trim(), (documento || '').trim() || null, (telefono || '').trim(),
       (direccion || '').trim(), (email || '').trim(), ahora, id]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ mensaje: 'Cliente actualizado' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Otro cliente ya tiene ese documento.' });
    }
    serverError(res, err, 'actualizar cliente');
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id invalido');
    const r = await dbp.run('DELETE FROM clientes WHERE id = ?', [id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ mensaje: 'Eliminado' });
  } catch (err) { serverError(res, err, 'eliminar cliente'); }
});

// ====== RESPALDOS DE BASE DE DATOS ======
app.get('/api/backups', async (req, res) => {
  try {
    const archivos = fs.readdirSync(carpetaBackups)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(carpetaBackups, f));
        return {
          nombre: f,
          tamanoBytes: stat.size,
          fechaCreacion: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
    res.json(archivos);
  } catch (err) { serverError(res, err, 'listar respaldos'); }
});

app.post('/api/backup', async (req, res) => {
  try {
    const info = await crearRespaldoVacuum();
    limpiarRespaldosAntiguos().catch(err => console.error('Limpieza de respaldos fallida:', err));
    res.json({ mensaje: 'Respaldo creado', ...info });
  } catch (err) { serverError(res, err, 'crear respaldo'); }
});

/**
 * Crea un snapshot consistente usando VACUUM INTO y devuelve metadata.
 * Reusado por POST /api/backup y por el respaldo automático del arranque.
 */
async function crearRespaldoVacuum() {
  const ahora = new Date();
  const stamp = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}${String(ahora.getSeconds()).padStart(2, '0')}`;
  const nombre = `inventario-${stamp}.db`;
  const destino = path.join(carpetaBackups, nombre);
  await dbp.run('VACUUM INTO ?', [destino]);
  const stat = fs.statSync(destino);
  return { nombre, tamanoBytes: stat.size, fechaCreacion: stat.mtime.toISOString(), ruta: destino };
}

/**
 * Borra respaldos viejos para que no llenen el disco. Política: conservar los
 * últimos 30 respaldos. Los más viejos se borran.
 */
async function limpiarRespaldosAntiguos(maxBackups = 30) {
  try {
    const archivos = fs.readdirSync(carpetaBackups)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ nombre: f, mtime: fs.statSync(path.join(carpetaBackups, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime); // más nuevo primero
    const sobrantes = archivos.slice(maxBackups);
    for (const f of sobrantes) {
      try {
        fs.unlinkSync(path.join(carpetaBackups, f.nombre));
        console.log('Respaldo antiguo eliminado:', f.nombre);
      } catch (e) { /* lo ignoramos, no es crítico */ }
    }
  } catch (err) {
    console.error('Error limpiando respaldos:', err);
  }
}

/**
 * Respaldo automático: si todavía no hay un respaldo de hoy, crea uno.
 * Se ejecuta al iniciar el servidor (poco después de abrir la BD).
 */
async function respaldoDiarioAutomatico() {
  try {
    const hoy = new Date();
    const stampHoy = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
    const yaHay = fs.readdirSync(carpetaBackups).some(f => f.startsWith(`inventario-${stampHoy}`));
    if (yaHay) return;
    await crearRespaldoVacuum();
    console.log('Respaldo automático diario creado.');
    limpiarRespaldosAntiguos().catch(() => {});
  } catch (err) {
    console.error('Respaldo automático fallido:', err);
  }
}

app.delete('/api/backups/:nombre', async (req, res) => {
  const nombre = req.params.nombre;
  if (!nombre || !/^[a-zA-Z0-9._-]+\.db$/.test(nombre)) {
    return badRequest(res, 'nombre de respaldo invalido');
  }
  try {
    const ruta = path.join(carpetaBackups, nombre);
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Respaldo no encontrado' });
    fs.unlinkSync(ruta);
    res.json({ mensaje: 'Respaldo eliminado' });
  } catch (err) { serverError(res, err, 'eliminar respaldo'); }
});

app.post('/api/restore', async (req, res) => {
  const errors = validate(req.body, schemaRestore);
  if (errors) return badRequest(res, errors);
  const nombre = req.body.nombre;
  const fuente = path.join(carpetaBackups, nombre);
  try {
    if (!fs.existsSync(fuente)) return res.status(404).json({ error: 'Respaldo no encontrado' });
    fs.writeFileSync(markerRestore, nombre, 'utf8');
    res.json({
      mensaje: 'Restauracion programada. Cierra y vuelve a abrir la aplicacion para aplicar el respaldo.',
      requiereReinicio: true,
      nombre
    });
  } catch (err) { serverError(res, err, 'programar restauracion'); }
});

// ====== CIERRE ======
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\nCerrando base de datos...');
  db.close(() => process.exit(0));
});
