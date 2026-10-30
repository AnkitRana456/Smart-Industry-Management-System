/** Empty the database, then rebuild indexes so unique constraints exist before the first test runs. */
export async function freshDb(mongoose) {
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
