import Link from "next/link";

import { D20Icon } from "@/components/brand-logo";

export default function NotFound() {
  return (
    <div className="console-not-found">
      <D20Icon size={72} className="console-not-found__dice" />
      <h1 className="console-not-found__title">404</h1>
      <p className="console-not-found__text">
        啊咧……这个页面，才、才不是故意弄丢的呢！
      </p>
      <Link href="/" className="console-not-found__link">
        返回总览
      </Link>
    </div>
  );
}
