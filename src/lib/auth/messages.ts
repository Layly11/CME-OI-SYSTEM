/** ข้อความภาษาไทยของระบบสมาชิก รวมไว้ที่เดียว */
export const authMessages = {
  invalidLogin: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  rateLimited: "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  systemError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  emailTaken: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ",
  acceptRequired: "กรุณายอมรับข้อตกลงก่อนสมัคร",
  passwordTooShort: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
  passwordTooLong: "รหัสผ่านยาวเกินไป (ไม่เกิน 128 ตัวอักษร)",
  passwordTooCommon: "รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งใหม่",
  passwordSameAsEmail: "รหัสผ่านต้องไม่เหมือนอีเมล",
  nameRequired: "กรุณากรอกชื่อ–นามสกุล",
  nameTooLong: "ชื่อยาวเกินไป (ไม่เกิน 100 ตัวอักษร)",
  emailInvalid: "รูปแบบอีเมลไม่ถูกต้อง",
  phoneInvalid: "เบอร์โทรใช้ได้เฉพาะตัวเลข + - และเว้นวรรค ความยาว 9–20 ตัว",
  lineIdTooLong: "LINE ID ยาวเกินไป (ไม่เกิน 50 ตัวอักษร)",
} as const;

export type PasswordPolicyError =
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordTooCommon"
  | "passwordSameAsEmail";
