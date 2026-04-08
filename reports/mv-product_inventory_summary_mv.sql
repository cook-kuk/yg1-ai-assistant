 SELECT edp,
    normalized_edp,
    sum(quantity) AS total_stock,
    count(DISTINCT warehouse_or_region) FILTER (WHERE quantity > 0) AS warehouse_count,
    max(snapshot_date) AS snapshot_date
   FROM catalog_app.inventory_snapshot
  WHERE edp IS NOT NULL
  GROUP BY edp, normalized_edp;