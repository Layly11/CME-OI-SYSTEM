import { sampleLadder } from "@/content/site";

const fmt = new Intl.NumberFormat("en-US");

/**
 * ตาราง Option Flow จำลองหน้าตาแผงข้อมูลจริงของ indicator
 * ใช้ข้อมูลจากหน้าจอจริง (ดู content/site.ts) ไม่ใช่ข้อมูลสด
 */
export function Ladder() {
  const max = Math.max(...sampleLadder.rows.map((r) => r.abs));

  return (
    <figure className="on-ink rounded-lg border border-ink-line bg-ink-deep p-4 text-on-ink shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-5">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="text-[13px] font-semibold tracking-wide text-on-ink">OPTION FLOW</span>
        <span className="text-[12px] text-on-ink-muted">XAUUSD M30</span>
      </figcaption>

      <table className="tabular mt-3 w-full border-collapse text-[13px] sm:text-[14px]">
        <thead>
          <tr className="text-[11.5px] text-on-ink-muted">
            <th scope="col" className="pb-2 text-left font-medium">
              ราคา
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-call">
              CALL
            </th>
            <th scope="col" className="pb-2 text-right font-medium text-put">
              PUT
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              NET
            </th>
            <th scope="col" className="pb-2 pl-3 text-left font-medium">
              ABS NET
            </th>
          </tr>
        </thead>
        <tbody>
          {sampleLadder.rows.map((r) => {
            const hot = r.price === sampleLadder.highlightPrice;
            const width = Math.max(4, Math.round((r.abs / max) * 100));
            return (
              <tr
                key={r.price}
                className={`border-t border-ink-line/70 ${hot ? "bg-gold/10" : ""}`}
              >
                <th
                  scope="row"
                  className={`py-1.5 text-left font-medium ${hot ? "text-gold" : "text-on-ink"}`}
                >
                  {r.price}
                </th>
                <td className="py-1.5 text-right text-call">{fmt.format(r.call)}</td>
                <td className="py-1.5 text-right text-put">{fmt.format(r.put)}</td>
                <td className="py-1.5 text-right text-on-ink">+{fmt.format(r.net)}</td>
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-sm bg-white/5">
                      <div
                        className={`h-full rounded-sm ${hot ? "bg-gold" : "bg-on-ink-muted/60"}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className={`w-12 text-right ${hot ? "font-semibold text-gold" : "text-on-ink"}`}>
                      {fmt.format(r.abs)}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-4 border-t border-ink-line pt-3 text-[12.5px] leading-relaxed text-on-ink-muted">
        {sampleLadder.highlightNote}
      </p>
      <p className="mt-1 text-[11.5px] text-on-ink-muted/80">{sampleLadder.caption}</p>
    </figure>
  );
}
