"use client";

import { Button, Result } from "antd";

export default function ConsoleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="console-error">
      <Result
        status="error"
        title="呜哇，页面出错了……"
        subTitle="骰子掷出了大失败。要、要不再试一次？"
        extra={
          <Button type="primary" onClick={reset}>
            重新掷一次
          </Button>
        }
      />
    </div>
  );
}
