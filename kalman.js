import { create, all } from "https://esm.sh/mathjs@14.1.0";
const math = create(all);

// Clase del filtro de Kalman para múltiples variables
export class KalmanFilter {
  constructor(Q = 1, R = 1, P = 1, X = 0) {
    this.Q = Q; // Ruido del proceso
    this.R = R; // Ruido de medición
    this.P = P; // Covarianza inicial
    this.X = X; // Estado inicial
  }

  // Predicción
  predict() {
    this.P = this.P + this.Q; // Actualizar la covarianza
  }

  update(measurement) {
    if (isNaN(measurement)) return this.X; // Evitar errores si la medición es NaN
    const K = this.P / (this.P + this.R); // Ganancia de Kalman
    this.X = this.X + K * (measurement - this.X); // Actualizar el estado
    this.P = (1 - K) * this.P; // Actualizar la covarianza
    return this.X; // Devolver el estado estimado
  }
}

// Aplicar filtro individualmente a cada variable
export function applyKalmanFilterPerVariable(data) {
  const kalmanFilters = {
    temperature: new KalmanFilter(), // Crear un filtro de Kalman para cada variable
    atmPressure: new KalmanFilter(),
    relHumidity: new KalmanFilter(),
    windSpeed: new KalmanFilter(),
    soilMoisture: new KalmanFilter(),
  };

  return {
    temperature: kalmanFilters.temperature.update(data.T), // Actualizar el filtro de Kalman con la medición
    atmPressure: kalmanFilters.atmPressure.update(data.P),
    relHumidity: kalmanFilters.relHumidity.update(data.HR),
    windSpeed: kalmanFilters.windSpeed.update(data.V),
    soilMoisture: kalmanFilters.soilMoisture.update(data.HS),
  };
}
