 WITH series_rows AS (
         SELECT ps._row_num,
            ps.idx,
            ps.root_category,
            ps.category_idx,
            ps.brand_idx,
            ps.brand_name,
            ps.series_name,
            ps.description,
            ps.feature,
            ps.file1,
            ps.file1_name,
            ps.series_icon_idx,
            ps.application_shape_icon_idx,
            ps.work_piece_idx,
            ps.tool_type,
            ps.sales,
            ps.application_shape,
            ps.cutting_edge_shape,
            ps.shank_type,
            ps.product_type,
            ps.cooling_type,
            ps.hole_type,
            ps.thread_direction,
            ps.geometry,
            ps.machining_condition,
            ps.country,
            ps.category,
            ps.sti,
            ps.file_pic,
            ps.file_pic_name,
            ps.file_dra,
            ps.file_dra_name,
            ps.unit,
            ps.type_idx,
            ps.flag_del,
            ps.flag_save,
            ps.flag_show_ecatalog,
            ps.flag_show,
            ps.reg_id,
            ps.reg_dtm,
            ps.modi_id,
            ps.modi_dtm,
            NULLIF(regexp_replace(upper(btrim(COALESCE(ps.series_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text) AS normalized_series_name,
            NULLIF(regexp_replace(upper(btrim(COALESCE(ps.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text) AS normalized_brand_name,
            row_number() OVER (PARTITION BY (NULLIF(regexp_replace(upper(btrim(COALESCE(ps.series_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text)) ORDER BY ps.idx DESC) AS series_rank
           FROM raw_catalog.prod_series ps
          WHERE COALESCE(ps.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(ps.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(btrim(ps.series_name), ''::text) IS NOT NULL
        ), series_base AS (
         SELECT series_rows._row_num,
            series_rows.idx,
            series_rows.root_category,
            series_rows.category_idx,
            series_rows.brand_idx,
            series_rows.brand_name,
            series_rows.series_name,
            series_rows.description,
            series_rows.feature,
            series_rows.file1,
            series_rows.file1_name,
            series_rows.series_icon_idx,
            series_rows.application_shape_icon_idx,
            series_rows.work_piece_idx,
            series_rows.tool_type,
            series_rows.sales,
            series_rows.application_shape,
            series_rows.cutting_edge_shape,
            series_rows.shank_type,
            series_rows.product_type,
            series_rows.cooling_type,
            series_rows.hole_type,
            series_rows.thread_direction,
            series_rows.geometry,
            series_rows.machining_condition,
            series_rows.country,
            series_rows.category,
            series_rows.sti,
            series_rows.file_pic,
            series_rows.file_pic_name,
            series_rows.file_dra,
            series_rows.file_dra_name,
            series_rows.unit,
            series_rows.type_idx,
            series_rows.flag_del,
            series_rows.flag_save,
            series_rows.flag_show_ecatalog,
            series_rows.flag_show,
            series_rows.reg_id,
            series_rows.reg_dtm,
            series_rows.modi_id,
            series_rows.modi_dtm,
            series_rows.normalized_series_name,
            series_rows.normalized_brand_name,
            series_rows.series_rank
           FROM series_rows
          WHERE series_rows.series_rank = 1
        ), series_variants AS (
         SELECT series_rows.normalized_series_name,
            array_agg(DISTINCT series_rows.series_name ORDER BY series_rows.series_name) AS series_name_variants,
            array_agg(DISTINCT series_rows.brand_name ORDER BY series_rows.brand_name) FILTER (WHERE NULLIF(btrim(series_rows.brand_name), ''::text) IS NOT NULL) AS brand_name_variants,
            array_agg(DISTINCT series_rows.root_category ORDER BY series_rows.root_category) FILTER (WHERE NULLIF(btrim(series_rows.root_category), ''::text) IS NOT NULL) AS root_categories,
            array_agg(DISTINCT series_rows.tool_type ORDER BY series_rows.tool_type) FILTER (WHERE NULLIF(btrim(series_rows.tool_type), ''::text) IS NOT NULL) AS tool_types,
            array_agg(DISTINCT series_rows.product_type ORDER BY series_rows.product_type) FILTER (WHERE NULLIF(btrim(series_rows.product_type), ''::text) IS NOT NULL) AS product_types,
            array_agg(DISTINCT series_rows.application_shape ORDER BY series_rows.application_shape) FILTER (WHERE NULLIF(btrim(series_rows.application_shape), ''::text) IS NOT NULL) AS application_shape_values,
            array_agg(DISTINCT series_rows.cutting_edge_shape ORDER BY series_rows.cutting_edge_shape) FILTER (WHERE NULLIF(btrim(series_rows.cutting_edge_shape), ''::text) IS NOT NULL) AS cutting_edge_shape_values,
            array_agg(DISTINCT series_rows.shank_type ORDER BY series_rows.shank_type) FILTER (WHERE NULLIF(btrim(series_rows.shank_type), ''::text) IS NOT NULL) AS shank_type_values,
            array_agg(DISTINCT series_rows.cooling_type ORDER BY series_rows.cooling_type) FILTER (WHERE NULLIF(btrim(series_rows.cooling_type), ''::text) IS NOT NULL) AS cooling_type_values,
            array_agg(DISTINCT series_rows.hole_type ORDER BY series_rows.hole_type) FILTER (WHERE NULLIF(btrim(series_rows.hole_type), ''::text) IS NOT NULL) AS hole_type_values,
            array_agg(DISTINCT series_rows.thread_direction ORDER BY series_rows.thread_direction) FILTER (WHERE NULLIF(btrim(series_rows.thread_direction), ''::text) IS NOT NULL) AS thread_direction_values,
            array_agg(DISTINCT series_rows.geometry ORDER BY series_rows.geometry) FILTER (WHERE NULLIF(btrim(series_rows.geometry), ''::text) IS NOT NULL) AS geometry_values,
            array_agg(DISTINCT series_rows.machining_condition ORDER BY series_rows.machining_condition) FILTER (WHERE NULLIF(btrim(series_rows.machining_condition), ''::text) IS NOT NULL) AS machining_condition_values,
            array_agg(DISTINCT series_rows.unit ORDER BY series_rows.unit) FILTER (WHERE NULLIF(btrim(series_rows.unit), ''::text) IS NOT NULL) AS unit_values,
            array_agg(DISTINCT series_rows.country ORDER BY series_rows.country) FILTER (WHERE NULLIF(btrim(series_rows.country), ''::text) IS NOT NULL) AS raw_country_values,
            array_agg(DISTINCT series_rows.description ORDER BY series_rows.description) FILTER (WHERE NULLIF(btrim(series_rows.description), ''::text) IS NOT NULL) AS description_variants,
            array_agg(DISTINCT series_rows.feature ORDER BY series_rows.feature) FILTER (WHERE NULLIF(btrim(series_rows.feature), ''::text) IS NOT NULL) AS feature_variants,
            array_agg(DISTINCT series_rows.file1 ORDER BY series_rows.file1) FILTER (WHERE NULLIF(btrim(series_rows.file1), ''::text) IS NOT NULL) AS file1_values,
            array_agg(DISTINCT series_rows.file_pic ORDER BY series_rows.file_pic) FILTER (WHERE NULLIF(btrim(series_rows.file_pic), ''::text) IS NOT NULL) AS file_pic_values,
            array_agg(DISTINCT series_rows.file_dra ORDER BY series_rows.file_dra) FILTER (WHERE NULLIF(btrim(series_rows.file_dra), ''::text) IS NOT NULL) AS file_dra_values
           FROM series_rows
          GROUP BY series_rows.normalized_series_name
        ), series_sub_ranked AS (
         SELECT sr.normalized_series_name,
            upper(btrim(COALESCE(pss.lang, ''::text))) AS lang,
            NULLIF(btrim(pss.series_name), ''::text) AS localized_series_name,
            NULLIF(btrim(pss.description), ''::text) AS localized_description,
            NULLIF(btrim(pss.feature), ''::text) AS localized_feature,
            row_number() OVER (PARTITION BY sr.normalized_series_name, (upper(btrim(COALESCE(pss.lang, ''::text)))) ORDER BY pss.prod_series_idx DESC, pss.reg_dtm DESC) AS lang_rank
           FROM raw_catalog.prod_series_sub pss
             JOIN series_rows sr ON sr.idx = pss.prod_series_idx
          WHERE COALESCE(pss.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(pss.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(btrim(COALESCE(pss.lang, ''::text)), ''::text) IS NOT NULL
        ), series_translations AS (
         SELECT series_sub_ranked.normalized_series_name,
            jsonb_object_agg(series_sub_ranked.lang, jsonb_strip_nulls(jsonb_build_object('series_name', series_sub_ranked.localized_series_name, 'description', series_sub_ranked.localized_description, 'feature', series_sub_ranked.localized_feature))) AS translations_by_lang
           FROM series_sub_ranked
          WHERE series_sub_ranked.lang_rank = 1
          GROUP BY series_sub_ranked.normalized_series_name
        ), iso_detail_reference AS (
         SELECT DISTINCT NULLIF(upper(btrim(COALESCE(iso_detail_reference.tag_name, ''::text))), ''::text) AS tag_name,
            NULLIF(btrim(iso_detail_reference.work_piece_name), ''::text) AS work_piece_name,
            NULLIF(regexp_replace(upper(btrim(COALESCE(iso_detail_reference.work_piece_name, ''::text))), '\s+'::text, ''::text, 'g'::text), ''::text) AS normalized_work_piece_name
           FROM catalog_app.iso_detail_reference
          WHERE NULLIF(btrim(COALESCE(iso_detail_reference.tag_name, ''::text)), ''::text) IS NOT NULL AND NULLIF(btrim(COALESCE(iso_detail_reference.work_piece_name, ''::text)), ''::text) IS NOT NULL
        ), series_material_tag_rows AS (
         SELECT DISTINCT sr.normalized_series_name,
            NULLIF(upper(btrim(COALESCE(sm_1.tag_name, ''::text))), ''::text) AS tag_name
           FROM raw_catalog.prod_series_work_material_status sm_1
             JOIN series_rows sr ON sr.idx = sm_1.prod_series_idx
          WHERE COALESCE(sm_1.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(sm_1.flag_show, 'Y'::text) = 'Y'::text
        ), series_material_rows AS (
         SELECT DISTINCT sr.normalized_series_name,
            NULLIF(upper(btrim(COALESCE(sm_1.tag_name, ''::text))), ''::text) AS tag_name,
            ref.work_piece_name,
            ref.normalized_work_piece_name,
                CASE
                    WHEN NULLIF(btrim(COALESCE(sm_1.status, ''::text)), ''::text) IS NULL THEN 'NULL'::text
                    WHEN upper(btrim(sm_1.status)) = 'EXCELLENT'::text THEN 'EXCELLENT'::text
                    WHEN upper(btrim(sm_1.status)) = 'GOOD'::text THEN 'GOOD'::text
                    WHEN upper(btrim(sm_1.status)) = 'NULL'::text THEN 'NULL'::text
                    ELSE 'NULL'::text
                END AS status,
                CASE
                    WHEN upper(btrim(COALESCE(sm_1.status, ''::text))) = 'EXCELLENT'::text THEN 3
                    WHEN upper(btrim(COALESCE(sm_1.status, ''::text))) = 'GOOD'::text THEN 2
                    ELSE 1
                END AS material_rating_score
           FROM raw_catalog.prod_series_work_material_status sm_1
             JOIN series_rows sr ON sr.idx = sm_1.prod_series_idx
             JOIN iso_detail_reference ref ON ref.tag_name = NULLIF(upper(btrim(COALESCE(sm_1.tag_name, ''::text))), ''::text) AND ref.normalized_work_piece_name = NULLIF(regexp_replace(upper(btrim(COALESCE(sm_1.work_piece_name, ''::text))), '\s+'::text, ''::text, 'g'::text), ''::text)
          WHERE COALESCE(sm_1.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(sm_1.flag_show, 'Y'::text) = 'Y'::text
        ), series_material_tags AS (
         SELECT series_material_tag_rows.normalized_series_name,
            array_agg(DISTINCT series_material_tag_rows.tag_name ORDER BY series_material_tag_rows.tag_name) FILTER (WHERE series_material_tag_rows.tag_name IS NOT NULL) AS material_tags
           FROM series_material_tag_rows
          GROUP BY series_material_tag_rows.normalized_series_name
        ), series_material_details AS (
         SELECT series_material_rows.normalized_series_name,
            array_agg(DISTINCT series_material_rows.work_piece_name ORDER BY series_material_rows.work_piece_name) FILTER (WHERE series_material_rows.work_piece_name IS NOT NULL) AS material_work_piece_names,
            jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tag_name', series_material_rows.tag_name, 'work_piece_name', series_material_rows.work_piece_name, 'normalized_work_piece_name', series_material_rows.normalized_work_piece_name, 'status', series_material_rows.status, 'material_rating', series_material_rows.status, 'material_rating_score', series_material_rows.material_rating_score)) ORDER BY series_material_rows.tag_name, series_material_rows.work_piece_name, series_material_rows.material_rating_score DESC, series_material_rows.status) FILTER (WHERE series_material_rows.tag_name IS NOT NULL OR series_material_rows.work_piece_name IS NOT NULL OR series_material_rows.status IS NOT NULL) AS work_piece_statuses
           FROM series_material_rows
          GROUP BY series_material_rows.normalized_series_name
        ), series_materials AS (
         SELECT tags.normalized_series_name,
            tags.material_tags,
            details.material_work_piece_names,
            details.work_piece_statuses
           FROM series_material_tags tags
             LEFT JOIN series_material_details details ON details.normalized_series_name = tags.normalized_series_name
        ), ranked_edp AS (
         SELECT pe._row_num,
            pe.idx,
            pe.root_category,
            pe.category_idx,
            pe.brand_idx,
            pe.brand_name,
            pe.series_idx,
            pe.series_name,
            pe.edp_no,
            pe.your_code,
            pe.file1,
            pe.file2,
            pe.file3,
            pe.dxf,
            pe.dxf_name,
            pe.stp,
            pe.stp_name,
            pe.unit,
            pe.option_od,
            pe.option_r,
            pe.option_sd,
            pe.option_loc,
            pe.option_oal,
            pe.option_flute,
            pe.option_z,
            pe.option_dc,
            pe.option_dcx,
            pe.option_lf,
            pe.option_dcon,
            pe.option_cbdp,
            pe.option_dcsfms,
            pe.option_apmx,
            pe.option_drill_diameter,
            pe.option_shank_diameter,
            pe.option_flute_length,
            pe.option_overall_length,
            pe.option_length,
            pe.option_depth_of_hole,
            pe.option_d1,
            pe.option_size,
            pe.option_pitch,
            pe.option_tpi,
            pe.option_designation,
            pe.option_re,
            pe.option_l,
            pe.option_ic,
            pe.option_s,
            pe.option_lbs,
            pe.option_chip_breaker,
            pe.option_model_no,
            pe.option_grade,
            pe.option_d,
            pe.option_clamping_range,
            pe.option_nut_collet,
            pe.option_taper_no,
            pe.flag_del,
            pe.flag_save,
            pe.flag_show,
            pe.reg_id,
            pe.reg_dtm,
            pe.modi_id,
            pe.modi_dtm,
            pe.option_thread_shape,
            pe.option_pitch_tpi,
            pe.option_thread_tolerance_class,
            pe.option_chamfer_length,
            pe.option_coolant,
            pe.option_hand,
            pe.option_dmin,
            pe.option_h,
            pe.option_b,
            pe.option_wf,
            pe.option_insert,
            pe.option_cw,
            pe.option_cdx,
            pe.option_series,
            pe.option_series_description,
            pe.option_series_filter,
            pe.option_chip_breaker_description,
            pe.option_loc_1,
            pe.option_lbs_1,
            pe.option_tolofmilldia,
            pe.option_tolofshankdia,
            pe.option_taperangle,
            pe.option_coolanthole,
            pe.option_threadlength,
            pe.option_shankdia,
            pe.option_squaresize,
            pe.option_numberofflute,
            pe.option_connection_type,
            row_number() OVER (PARTITION BY pe.edp_no ORDER BY pe.idx DESC) AS edp_rank
           FROM raw_catalog.prod_edp pe
          WHERE COALESCE(pe.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(pe.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(pe.edp_no, ''::text) IS NOT NULL
        ), dedup_edp AS (
         SELECT ranked_edp._row_num,
            ranked_edp.idx,
            ranked_edp.root_category,
            ranked_edp.category_idx,
            ranked_edp.brand_idx,
            ranked_edp.brand_name,
            ranked_edp.series_idx,
            ranked_edp.series_name,
            ranked_edp.edp_no,
            ranked_edp.your_code,
            ranked_edp.file1,
            ranked_edp.file2,
            ranked_edp.file3,
            ranked_edp.dxf,
            ranked_edp.dxf_name,
            ranked_edp.stp,
            ranked_edp.stp_name,
            ranked_edp.unit,
            ranked_edp.option_od,
            ranked_edp.option_r,
            ranked_edp.option_sd,
            ranked_edp.option_loc,
            ranked_edp.option_oal,
            ranked_edp.option_flute,
            ranked_edp.option_z,
            ranked_edp.option_dc,
            ranked_edp.option_dcx,
            ranked_edp.option_lf,
            ranked_edp.option_dcon,
            ranked_edp.option_cbdp,
            ranked_edp.option_dcsfms,
            ranked_edp.option_apmx,
            ranked_edp.option_drill_diameter,
            ranked_edp.option_shank_diameter,
            ranked_edp.option_flute_length,
            ranked_edp.option_overall_length,
            ranked_edp.option_length,
            ranked_edp.option_depth_of_hole,
            ranked_edp.option_d1,
            ranked_edp.option_size,
            ranked_edp.option_pitch,
            ranked_edp.option_tpi,
            ranked_edp.option_designation,
            ranked_edp.option_re,
            ranked_edp.option_l,
            ranked_edp.option_ic,
            ranked_edp.option_s,
            ranked_edp.option_lbs,
            ranked_edp.option_chip_breaker,
            ranked_edp.option_model_no,
            ranked_edp.option_grade,
            ranked_edp.option_d,
            ranked_edp.option_clamping_range,
            ranked_edp.option_nut_collet,
            ranked_edp.option_taper_no,
            ranked_edp.flag_del,
            ranked_edp.flag_save,
            ranked_edp.flag_show,
            ranked_edp.reg_id,
            ranked_edp.reg_dtm,
            ranked_edp.modi_id,
            ranked_edp.modi_dtm,
            ranked_edp.option_thread_shape,
            ranked_edp.option_pitch_tpi,
            ranked_edp.option_thread_tolerance_class,
            ranked_edp.option_chamfer_length,
            ranked_edp.option_coolant,
            ranked_edp.option_hand,
            ranked_edp.option_dmin,
            ranked_edp.option_h,
            ranked_edp.option_b,
            ranked_edp.option_wf,
            ranked_edp.option_insert,
            ranked_edp.option_cw,
            ranked_edp.option_cdx,
            ranked_edp.option_series,
            ranked_edp.option_series_description,
            ranked_edp.option_series_filter,
            ranked_edp.option_chip_breaker_description,
            ranked_edp.option_loc_1,
            ranked_edp.option_lbs_1,
            ranked_edp.option_tolofmilldia,
            ranked_edp.option_tolofshankdia,
            ranked_edp.option_taperangle,
            ranked_edp.option_coolanthole,
            ranked_edp.option_threadlength,
            ranked_edp.option_shankdia,
            ranked_edp.option_squaresize,
            ranked_edp.option_numberofflute,
            ranked_edp.option_connection_type,
            ranked_edp.edp_rank
           FROM ranked_edp
          WHERE ranked_edp.edp_rank = 1
        ), country_sources AS (
         SELECT raw_country_codes.edp_no,
            btrim(raw_country_codes.country_code) AS country_code
           FROM ( SELECT pm.edp_no,
                    country_row.country_code
                   FROM raw_catalog.prod_edp_option_milling pm,
                    LATERAL unnest(string_to_array(COALESCE(pm.country, ''::text), ','::text)) country_row(country_code)
                UNION ALL
                 SELECT ph.edp_no,
                    country_row.country_code
                   FROM raw_catalog.prod_edp_option_holemaking ph,
                    LATERAL unnest(string_to_array(COALESCE(ph.country, ''::text), ','::text)) country_row(country_code)
                UNION ALL
                 SELECT pt.edp_no,
                    country_row.country_code
                   FROM raw_catalog.prod_edp_option_threading pt,
                    LATERAL unnest(string_to_array(COALESCE(pt.country, ''::text), ','::text)) country_row(country_code)
                UNION ALL
                 SELECT ptool.edp_no,
                    country_row.country_code
                   FROM raw_catalog.prod_edp_option_tooling ptool,
                    LATERAL unnest(string_to_array(COALESCE(ptool.country, ''::text), ','::text)) country_row(country_code)
                UNION ALL
                 SELECT pturn.edp_no,
                    country_row.country_code
                   FROM raw_catalog.prod_edp_option_turning pturn,
                    LATERAL unnest(string_to_array(COALESCE(pturn.country, ''::text), ','::text)) country_row(country_code)) raw_country_codes
          WHERE btrim(raw_country_codes.country_code) <> ''::text
        ), edp_countries AS (
         SELECT country_sources.edp_no,
            array_agg(DISTINCT country_sources.country_code ORDER BY country_sources.country_code) AS country_codes
           FROM country_sources
          GROUP BY country_sources.edp_no
        ), edp_enriched AS (
         SELECT COALESCE(NULLIF(regexp_replace(upper(btrim(COALESCE(pe.series_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text), sr.normalized_series_name) AS normalized_series_name,
            pe.edp_no,
            COALESCE(NULLIF(btrim(pe.series_name), ''::text), sr.series_name) AS edp_series_name,
            COALESCE(NULLIF(btrim(pe.brand_name), ''::text), sr.brand_name) AS edp_brand_name,
            pe.unit AS edp_unit,
            COALESCE(NULLIF(pm.option_milling_numberofflute, ''::text), NULLIF(ph.option_holemaking_numberofflute, ''::text), NULLIF(pt.option_threading_numberofflute, ''::text), NULLIF(pe.option_numberofflute, ''::text), NULLIF(pe.option_z, ''::text)) AS flute_raw,
            COALESCE(NULLIF(pm.option_milling_coating, ''::text), NULLIF(ph.option_holemaking_coating, ''::text), NULLIF(pt.option_threading_coating, ''::text)) AS coating,
            COALESCE(NULLIF(pm.option_milling_toolmaterial, ''::text), NULLIF(ph.option_holemaking_toolmaterial, ''::text), NULLIF(pt.option_threading_toolmaterial, ''::text)) AS tool_material,
                CASE
                    WHEN upper(COALESCE(pe.unit, ''::text)) ~~ '%INCH%'::text THEN NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_outsidedia, ''::text), NULLIF(ph.option_holemaking_outsidedia, ''::text), NULLIF(pt.option_threading_outsidedia, ''::text), NULLIF(pe.option_drill_diameter, ''::text), NULLIF(pe.option_d1, ''::text), NULLIF(pe.option_dc, ''::text), NULLIF(pe.option_d, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric * 25.4
                    ELSE NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_outsidedia, ''::text), NULLIF(ph.option_holemaking_outsidedia, ''::text), NULLIF(pt.option_threading_outsidedia, ''::text), NULLIF(pe.option_drill_diameter, ''::text), NULLIF(pe.option_d1, ''::text), NULLIF(pe.option_dc, ''::text), NULLIF(pe.option_d, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric
                END AS diameter_mm,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_shankdia, ''::text), NULLIF(ph.option_holemaking_shankdia, ''::text), NULLIF(pt.option_threading_shankdia, ''::text), NULLIF(pe.option_shank_diameter, ''::text), NULLIF(pe.option_dcon, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS shank_diameter_mm,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_lengthofcut, ''::text), NULLIF(ph.option_holemaking_flutelength, ''::text), NULLIF(pt.option_threading_threadlength, ''::text), NULLIF(pe.option_flute_length, ''::text), NULLIF(pe.option_loc, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS length_of_cut_mm,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_overalllength, ''::text), NULLIF(ph.option_holemaking_overalllength, ''::text), NULLIF(pt.option_threading_overalllength, ''::text), NULLIF(pe.option_overall_length, ''::text), NULLIF(pe.option_oal, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS overall_length_mm,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_helixangle, ''::text), NULLIF(ph.option_holemaking_helixangle, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS helix_angle_deg,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_radiusofballnose, ''::text), NULLIF(pe.option_r, ''::text), NULLIF(pe.option_re, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS ball_radius_mm,
            NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_taperangle, ''::text), NULLIF(pe.option_taperangle, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric AS taper_angle_deg,
            COALESCE(NULLIF(pm.option_milling_cuttingedgeshape, ''::text), NULLIF(sr.cutting_edge_shape, ''::text), NULLIF(pm.option_milling_cuttershape, ''::text), NULLIF(pt.option_threading_flutetype, ''::text), NULLIF(pt.option_threading_threadshape, ''::text)) AS tool_subtype,
                CASE
                    WHEN lower(COALESCE(NULLIF(pm.option_milling_coolanthole, ''::text), NULLIF(ph.option_holemaking_coolanthole, ''::text), NULLIF(pt.option_threading_coolanthole, ''::text), NULLIF(pe.option_coolanthole, ''::text))) = ANY (ARRAY['y'::text, 'yes'::text, 'true'::text, '1'::text]) THEN true
                    WHEN lower(COALESCE(NULLIF(pm.option_milling_coolanthole, ''::text), NULLIF(ph.option_holemaking_coolanthole, ''::text), NULLIF(pt.option_threading_coolanthole, ''::text), NULLIF(pe.option_coolanthole, ''::text))) = ANY (ARRAY['n'::text, 'no'::text, 'false'::text, '0'::text]) THEN false
                    ELSE NULL::boolean
                END AS coolant_hole,
            COALESCE(country_source.country_codes, ARRAY[]::text[]) AS country_codes
           FROM dedup_edp pe
             LEFT JOIN series_rows sr ON sr.idx = pe.series_idx
             LEFT JOIN edp_countries country_source ON country_source.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_milling pm ON pm.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_holemaking ph ON ph.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_threading pt ON pt.edp_no = pe.edp_no
        ), series_edp_agg AS (
         SELECT edp_enriched.normalized_series_name,
            count(*)::integer AS edp_count,
            array_agg(DISTINCT edp_enriched.edp_no ORDER BY edp_enriched.edp_no) AS edp_codes,
            array_agg(DISTINCT edp_enriched.edp_brand_name ORDER BY edp_enriched.edp_brand_name) FILTER (WHERE NULLIF(btrim(edp_enriched.edp_brand_name), ''::text) IS NOT NULL) AS edp_brand_names,
            array_agg(DISTINCT edp_enriched.edp_unit ORDER BY edp_enriched.edp_unit) FILTER (WHERE NULLIF(btrim(edp_enriched.edp_unit), ''::text) IS NOT NULL) AS edp_units,
            array_agg(DISTINCT NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric ORDER BY (NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric)) FILTER (WHERE NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text) IS NOT NULL) AS flute_counts,
            array_agg(DISTINCT edp_enriched.coating ORDER BY edp_enriched.coating) FILTER (WHERE NULLIF(btrim(edp_enriched.coating), ''::text) IS NOT NULL) AS coating_values,
            array_agg(DISTINCT edp_enriched.tool_material ORDER BY edp_enriched.tool_material) FILTER (WHERE NULLIF(btrim(edp_enriched.tool_material), ''::text) IS NOT NULL) AS tool_material_values,
            array_agg(DISTINCT edp_enriched.tool_subtype ORDER BY edp_enriched.tool_subtype) FILTER (WHERE NULLIF(btrim(edp_enriched.tool_subtype), ''::text) IS NOT NULL) AS tool_subtypes,
            min(edp_enriched.diameter_mm) AS diameter_min_mm,
            max(edp_enriched.diameter_mm) AS diameter_max_mm,
            min(edp_enriched.shank_diameter_mm) AS shank_diameter_min_mm,
            max(edp_enriched.shank_diameter_mm) AS shank_diameter_max_mm,
            min(edp_enriched.length_of_cut_mm) AS length_of_cut_min_mm,
            max(edp_enriched.length_of_cut_mm) AS length_of_cut_max_mm,
            min(edp_enriched.overall_length_mm) AS overall_length_min_mm,
            max(edp_enriched.overall_length_mm) AS overall_length_max_mm,
            array_agg(DISTINCT edp_enriched.helix_angle_deg ORDER BY edp_enriched.helix_angle_deg) FILTER (WHERE edp_enriched.helix_angle_deg IS NOT NULL) AS helix_angle_values,
            array_agg(DISTINCT edp_enriched.ball_radius_mm ORDER BY edp_enriched.ball_radius_mm) FILTER (WHERE edp_enriched.ball_radius_mm IS NOT NULL) AS ball_radius_values,
            array_agg(DISTINCT edp_enriched.taper_angle_deg ORDER BY edp_enriched.taper_angle_deg) FILTER (WHERE edp_enriched.taper_angle_deg IS NOT NULL) AS taper_angle_values,
            array_agg(DISTINCT edp_enriched.coolant_hole ORDER BY edp_enriched.coolant_hole) FILTER (WHERE edp_enriched.coolant_hole IS NOT NULL) AS coolant_hole_values
           FROM edp_enriched
          WHERE edp_enriched.normalized_series_name IS NOT NULL
          GROUP BY edp_enriched.normalized_series_name
        ), series_country_rows AS (
         SELECT DISTINCT ee.normalized_series_name,
            country_row.country_code
           FROM edp_enriched ee
             CROSS JOIN LATERAL unnest(ee.country_codes) country_row(country_code)
          WHERE ee.normalized_series_name IS NOT NULL AND NULLIF(btrim(country_row.country_code), ''::text) IS NOT NULL
        ), series_countries AS (
         SELECT series_country_rows.normalized_series_name,
            array_agg(DISTINCT series_country_rows.country_code ORDER BY series_country_rows.country_code) AS country_codes
           FROM series_country_rows
          GROUP BY series_country_rows.normalized_series_name
        ), new_brand_rows AS (
         SELECT DISTINCT
                CASE
                    WHEN new_brand_reference.normalized_brand_name ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN new_brand_reference.normalized_brand_name ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE new_brand_reference.normalized_brand_name
                END AS brand_family_key,
            new_brand_reference.is_new
           FROM catalog_app.new_brand_reference
          WHERE new_brand_reference.normalized_brand_name IS NOT NULL
        ), new_brands AS (
         SELECT new_brand_rows.brand_family_key,
            bool_or(COALESCE(new_brand_rows.is_new, false)) AS is_new
           FROM new_brand_rows
          WHERE new_brand_rows.brand_family_key IS NOT NULL
          GROUP BY new_brand_rows.brand_family_key
        ), reference_series_rows AS (
         SELECT DISTINCT br.normalized_series_name,
            br.series_name,
            br.brand_name,
            nb.is_new,
            br.tag_name,
            br.work_piece_name,
            br.hardness_min_hrc,
            br.hardness_max_hrc
           FROM catalog_app.brand_reference br
             LEFT JOIN new_brands nb ON nb.brand_family_key =
                CASE
                    WHEN br.normalized_brand_name ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN br.normalized_brand_name ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE br.normalized_brand_name
                END
          WHERE br.normalized_series_name IS NOT NULL
        ), reference_series AS (
         SELECT reference_series_rows.normalized_series_name,
            array_agg(DISTINCT reference_series_rows.series_name ORDER BY reference_series_rows.series_name) FILTER (WHERE NULLIF(btrim(reference_series_rows.series_name), ''::text) IS NOT NULL) AS reference_series_names,
            array_agg(DISTINCT reference_series_rows.brand_name ORDER BY reference_series_rows.brand_name) FILTER (WHERE NULLIF(btrim(reference_series_rows.brand_name), ''::text) IS NOT NULL) AS reference_brand_names,
            bool_or(COALESCE(reference_series_rows.is_new, false)) AS reference_is_new,
            array_agg(DISTINCT reference_series_rows.tag_name ORDER BY reference_series_rows.tag_name) FILTER (WHERE NULLIF(btrim(reference_series_rows.tag_name), ''::text) IS NOT NULL) AS reference_iso_groups,
            array_agg(DISTINCT reference_series_rows.work_piece_name ORDER BY reference_series_rows.work_piece_name) FILTER (WHERE NULLIF(btrim(reference_series_rows.work_piece_name), ''::text) IS NOT NULL) AS reference_work_piece_names,
            min(reference_series_rows.hardness_min_hrc) AS reference_hrc_min,
            max(reference_series_rows.hardness_max_hrc) AS reference_hrc_max,
            jsonb_agg(jsonb_strip_nulls(jsonb_build_object('brand_name', reference_series_rows.brand_name, 'is_new', reference_series_rows.is_new, 'tag_name', reference_series_rows.tag_name, 'work_piece_name', reference_series_rows.work_piece_name, 'hardness_min_hrc', reference_series_rows.hardness_min_hrc, 'hardness_max_hrc', reference_series_rows.hardness_max_hrc)) ORDER BY reference_series_rows.brand_name, reference_series_rows.tag_name, reference_series_rows.work_piece_name, reference_series_rows.hardness_min_hrc, reference_series_rows.hardness_max_hrc) AS reference_profiles
           FROM reference_series_rows
          GROUP BY reference_series_rows.normalized_series_name
        )
 SELECT sb.normalized_series_name,
    sb.series_name,
    sb.brand_name AS primary_brand_name,
    sb.root_category AS primary_root_category,
    sb.category_idx AS primary_category_idx,
    sb.description AS primary_description,
    sb.feature AS primary_feature,
    sb.tool_type AS primary_tool_type,
    sb.product_type AS primary_product_type,
    sb.application_shape AS primary_application_shape,
    sb.cutting_edge_shape AS primary_cutting_edge_shape,
    sb.shank_type AS primary_shank_type,
    sb.cooling_type AS primary_cooling_type,
    sb.hole_type AS primary_hole_type,
    sb.thread_direction AS primary_thread_direction,
    sb.geometry AS primary_geometry,
    sb.machining_condition AS primary_machining_condition,
    sb.unit AS primary_unit,
    sb.country AS primary_country,
    sv.series_name_variants,
    sv.brand_name_variants,
    sv.root_categories,
    sv.tool_types,
    sv.product_types,
    sv.application_shape_values,
    sv.cutting_edge_shape_values,
    sv.shank_type_values,
    sv.cooling_type_values,
    sv.hole_type_values,
    sv.thread_direction_values,
    sv.geometry_values,
    sv.machining_condition_values,
    sv.unit_values,
    sv.raw_country_values,
    sv.description_variants,
    sv.feature_variants,
    sv.file1_values,
    sv.file_pic_values,
    sv.file_dra_values,
    st.translations_by_lang,
    sm.material_tags,
    sm.material_work_piece_names,
    sm.work_piece_statuses,
    sc.country_codes,
    sea.edp_count,
    sea.edp_codes,
    sea.edp_brand_names,
    sea.edp_units,
    sea.flute_counts,
    sea.coating_values,
    sea.tool_material_values,
    sea.tool_subtypes,
    sea.diameter_min_mm,
    sea.diameter_max_mm,
    sea.shank_diameter_min_mm,
    sea.shank_diameter_max_mm,
    sea.length_of_cut_min_mm,
    sea.length_of_cut_max_mm,
    sea.overall_length_min_mm,
    sea.overall_length_max_mm,
    sea.helix_angle_values,
    sea.ball_radius_values,
    sea.taper_angle_values,
    sea.coolant_hole_values,
    rs.reference_series_names,
    rs.reference_brand_names,
    rs.reference_is_new,
    rs.reference_iso_groups,
    rs.reference_work_piece_names,
    rs.reference_hrc_min,
    rs.reference_hrc_max,
    rs.reference_profiles
   FROM series_base sb
     LEFT JOIN series_variants sv ON sv.normalized_series_name = sb.normalized_series_name
     LEFT JOIN series_translations st ON st.normalized_series_name = sb.normalized_series_name
     LEFT JOIN series_materials sm ON sm.normalized_series_name = sb.normalized_series_name
     LEFT JOIN series_countries sc ON sc.normalized_series_name = sb.normalized_series_name
     LEFT JOIN series_edp_agg sea ON sea.normalized_series_name = sb.normalized_series_name
     LEFT JOIN reference_series rs ON rs.normalized_series_name = sb.normalized_series_name;