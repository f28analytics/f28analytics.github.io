import React from "react";

import styles from "./Tooltip.module.css";

type TooltipProps = {
  content?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

const Tooltip: React.FC<TooltipProps> = ({ content, children, className }) => {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <div className={`${styles.tooltipWrapper}${className ? ` ${className}` : ""}`}>
      <div className={styles.trigger}>{children}</div>
      <div className={styles.bubble} role="tooltip">
        <div className={styles.card}>{content}</div>
        <div className={styles.tail} />
      </div>
    </div>
  );
};

export default Tooltip;
