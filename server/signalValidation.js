const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate', 'renegotiate', 'transceiverRequest']);

function isValidSignal(signal) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) return false;
  if (!SIGNAL_TYPES.has(signal.type)) return false;
  try {
    if (Buffer.byteLength(JSON.stringify(signal)) > 64_000) return false;
  } catch {
    return false;
  }

  if (signal.type === 'offer' || signal.type === 'answer') {
    return typeof signal.sdp === 'string' && signal.sdp.length > 0;
  }
  if (signal.type === 'candidate') {
    return Boolean(signal.candidate && typeof signal.candidate === 'object');
  }
  if (signal.type === 'renegotiate') return signal.renegotiate === true;
  return signal.transceiverRequest?.kind === 'audio' || signal.transceiverRequest?.kind === 'video';
}

module.exports = { isValidSignal };
