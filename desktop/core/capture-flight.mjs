// Evidence readback is deliberately absent from the user capture path. The
// flight queue already waits for renderer readiness before starting its clock.
// No asynchronous animation continuation may revive a canceled question.
export function enqueueCaptureFlight(flights, image, record = () => {}) {
  try {
    flights.add(image);
    return true;
  } catch {
    record('flight_failed');
    return false;
  }
}
