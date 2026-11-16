/**
 * โบรกเกอร์พาร์ตเนอร์ (IB) ที่ลูกค้าเลือกเปิดบัญชีได้ — ลิงก์จากผู้ให้บริการ (16 พ.ย. 2569)
 *
 * - ลิงก์มีรหัส IB ของผู้ให้บริการอยู่ใน URL ห้ามแก้/ตัดพารามิเตอร์
 * - โบรกเกอร์ไม่ส่งเลขบัญชีกลับมาให้ระบบ ลูกค้าเปิดบัญชีแล้วต้องกลับมากรอกเลขบัญชี MT5 เอง
 * - ระบบบันทึกแค่ว่าลูกค้า "เลือก" โบรกเกอร์ไหน (orders/mt5_accounts.partner_broker_code)
 *   รอบนี้ยังไม่มีอะไรตรวจว่าบัญชีอยู่ใต้ IB จริง — mt5_accounts.ib_status คงเป็น unverified
 * - name เดาจากโดเมนของลิงก์ รอผู้ให้บริการยืนยันชื่อที่ใช้แสดง
 */
export type PartnerBroker = {
  /** ใช้อ้างอิงในโค้ด/ฐานข้อมูล ห้ามเปลี่ยนหลังเปิดใช้ */
  code: string;
  name: string;
  registerUrl: string;
};

export const partnerBrokers: readonly PartnerBroker[] = [
  {
    code: "fisg",
    name: "FISG (InterStellar)",
    registerUrl: "https://my.fisg.com/register/trader?link_id=irdklcqz&referrer_id=v0cuv9zp",
  },
  {
    code: "cxm",
    name: "CXM",
    registerUrl: "https://gocxm.io/links/go/407230",
  },
  {
    code: "hfm",
    name: "HFM",
    registerUrl: "https://register.hfm.com/sv/en/new-live-account/?refid=371744",
  },
  {
    code: "kohle",
    name: "Kohle Capital",
    registerUrl: "https://mt5.kohlecapital.com/th/links/go/20149",
  },
  {
    code: "dooprime",
    name: "Doo Prime",
    registerUrl: "https://my.dooprime.com/th/links/go/32604",
  },
  {
    code: "hmarkets",
    name: "H Markets",
    registerUrl: "https://hmarkets.com/live-account-pre-registration/?cmp=6q0c6z6k&refid=11084&ent=hm",
  },
];
