export class Store {
  constructor(db) { this.db = db; }
  statement(sql, ...args) { return this.db.prepare(sql).bind(...args); }
  async one(sql, ...args) { return this.statement(sql, ...args).first(); }
  async all(sql, ...args) { return (await this.statement(sql, ...args).all()).results; }
  async run(sql, ...args) { return this.statement(sql, ...args).run(); }
  async batch(statements) { return this.db.batch(statements.map(([sql, ...args]) => this.statement(sql, ...args))); }
}
