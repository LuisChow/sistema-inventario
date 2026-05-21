/**
 * Envoltura Promise alrededor de node-sqlite3 para usar async/await.
 *
 * Uso:
 *   const { wrap } = require('./lib/db');
 *   const dbp = wrap(db);
 *   const rows = await dbp.all('SELECT * FROM repuestos');
 *   await dbp.run('UPDATE ... WHERE codigo = ?', [codigo]);
 *
 * Transacciones:
 *   await dbp.transaction(async () => {
 *     await dbp.run('UPDATE ...');
 *     await dbp.run('INSERT ...');
 *   });
 *   // Hace COMMIT si todo funciona, ROLLBACK si algo lanza.
 */

function wrap(db) {
  let inTransaction = false;

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  async function transaction(work) {
    if (inTransaction) {
      // Las transacciones anidadas no se soportan en SQLite sin SAVEPOINTs.
      // Ejecutamos directo para que el caller controle la transacción exterior.
      return work();
    }
    inTransaction = true;
    try {
      await run('BEGIN IMMEDIATE TRANSACTION');
      const result = await work();
      await run('COMMIT');
      return result;
    } catch (err) {
      try { await run('ROLLBACK'); } catch (_) { /* swallow */ }
      throw err;
    } finally {
      inTransaction = false;
    }
  }

  return { run, get, all, transaction };
}

module.exports = { wrap };
