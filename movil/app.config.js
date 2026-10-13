// La dirección de la API sin tocar app.json: ACCUMEDICAL_API_URL al arrancar
// (p. ej. https://concurrencia.pymes.ec para probar en un teléfono por internet).
// Sin la variable, manda el `extra.apiUrl` de app.json, como siempre.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    ...(process.env.ACCUMEDICAL_API_URL ? { apiUrl: process.env.ACCUMEDICAL_API_URL } : {}),
  },
})
