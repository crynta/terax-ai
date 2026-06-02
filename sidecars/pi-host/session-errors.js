export class SessionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionProtocolError";
    this.code = code;
  }
}
