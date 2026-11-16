/**
 * รูปแบบ state ที่ Server Action ส่งกลับให้ฟอร์ม (ใช้กับ useActionState)
 *
 * React 19 รีเซ็ตฟอร์มแบบ uncontrolled หลัง action จบ — action จึงส่ง `values` กลับมา
 * (ห้ามใส่รหัสผ่าน) แล้วฟอร์มใช้ `defaultValue={state.values?.x}` เพื่อคงค่าที่ผู้ใช้กรอกไว้
 */
export type FormState<F extends string = string> = {
  ok: boolean;
  formError?: string;
  fieldErrors?: Partial<Record<F, string>>;
  values?: Partial<Record<F, string>>;
};
