// Demo fleet for local testing. Runs only when the database has no trucks yet.
export function seedDemo(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM trucks').get();
  if (n > 0) return;

  const drivers = [
    ['Alex Morgan', '+1 555 0101'],
    ['Jordan Lee', '+1 555 0102'],
    ['Sam Patel', '+1 555 0103'],
  ];
  const insDriver = db.prepare('INSERT INTO drivers (name, phone) VALUES (?, ?)');
  const driverIds = drivers.map(([name, phone]) => Number(insDriver.run(name, phone).lastInsertRowid));

  const trucks = [
    ['101', 'TRK-1011', 'Freightliner', 'Cascadia', 2021, driverIds[0]],
    ['102', 'TRK-1022', 'Peterbilt', '579', 2020, driverIds[1]],
    ['103', 'TRK-1033', 'Kenworth', 'T680', 2022, null],
    ['104', 'TRK-1044', 'Volvo', 'VNL 760', 2019, null],
  ];
  const insTruck = db.prepare('INSERT INTO trucks (unit, plate, make, model, year, driver_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [unit, plate, make, model, year, driverId] of trucks) {
    insTruck.run(unit, plate, make, model, year, driverId);
  }
}
