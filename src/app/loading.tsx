import { D20Icon } from "@/components/brand-logo";

export default function Loading() {
  return (
    <div className="console-loading">
      <D20Icon size={56} className="console-loading__dice" />
      <p className="console-loading__text">掷骰中……</p>
    </div>
  );
}
