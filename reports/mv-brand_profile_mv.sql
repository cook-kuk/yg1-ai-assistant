 WITH active_brands AS (
         SELECT pb._row_num,
            pb.idx,
            pb.category_idx,
            pb.sub_category_idx,
            pb.brand_name,
            pb.description,
            pb.description2,
            pb.description3,
            pb.description4,
            pb.description5,
            pb.description_work_piece,
            pb.file1,
            pb.file1_name,
            pb.file2,
            pb.file2_name,
            pb.pdf_file1,
            pb.pdf_file1_name,
            pb.youtube_url,
            pb."order",
            pb.country,
            pb.video_yn,
            pb.catalog_yn,
            pb.news_yn,
            pb.related_brand_yn,
            pb.video_idx,
            pb.catalog_idx,
            pb.news_idx1,
            pb.news_idx2,
            pb.news_idx3,
            pb.related_brand_idx1,
            pb.related_brand_idx2,
            pb.related_brand_idx3,
            pb.related_brand_idx4,
            pb.flag_del,
            pb.flag_save,
            pb.flag_show,
            pb.reg_id,
            pb.reg_dtm,
            pb.modi_id,
            pb.modi_dtm,
            pb.flag_ecatalog_show,
            NULLIF(regexp_replace(upper(btrim(COALESCE(pb.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text) AS normalized_brand_name,
                CASE
                    WHEN regexp_replace(upper(btrim(COALESCE(pb.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN regexp_replace(upper(btrim(COALESCE(pb.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE NULLIF(regexp_replace(upper(btrim(COALESCE(pb.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text)
                END AS brand_family_key
           FROM raw_catalog.prod_brand pb
          WHERE COALESCE(pb.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(pb.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(btrim(pb.brand_name), ''::text) IS NOT NULL
        ), brand_ranked AS (
         SELECT ab._row_num,
            ab.idx,
            ab.category_idx,
            ab.sub_category_idx,
            ab.brand_name,
            ab.description,
            ab.description2,
            ab.description3,
            ab.description4,
            ab.description5,
            ab.description_work_piece,
            ab.file1,
            ab.file1_name,
            ab.file2,
            ab.file2_name,
            ab.pdf_file1,
            ab.pdf_file1_name,
            ab.youtube_url,
            ab."order",
            ab.country,
            ab.video_yn,
            ab.catalog_yn,
            ab.news_yn,
            ab.related_brand_yn,
            ab.video_idx,
            ab.catalog_idx,
            ab.news_idx1,
            ab.news_idx2,
            ab.news_idx3,
            ab.related_brand_idx1,
            ab.related_brand_idx2,
            ab.related_brand_idx3,
            ab.related_brand_idx4,
            ab.flag_del,
            ab.flag_save,
            ab.flag_show,
            ab.reg_id,
            ab.reg_dtm,
            ab.modi_id,
            ab.modi_dtm,
            ab.flag_ecatalog_show,
            ab.normalized_brand_name,
            ab.brand_family_key,
            row_number() OVER (PARTITION BY ab.brand_family_key ORDER BY (
                CASE
                    WHEN ab.normalized_brand_name = ab.brand_family_key THEN 0
                    ELSE 1
                END), (length(btrim(ab.brand_name))), ab.idx DESC) AS brand_rank
           FROM active_brands ab
          WHERE ab.brand_family_key IS NOT NULL
        ), brand_base AS (
         SELECT brand_ranked._row_num,
            brand_ranked.idx,
            brand_ranked.category_idx,
            brand_ranked.sub_category_idx,
            brand_ranked.brand_name,
            brand_ranked.description,
            brand_ranked.description2,
            brand_ranked.description3,
            brand_ranked.description4,
            brand_ranked.description5,
            brand_ranked.description_work_piece,
            brand_ranked.file1,
            brand_ranked.file1_name,
            brand_ranked.file2,
            brand_ranked.file2_name,
            brand_ranked.pdf_file1,
            brand_ranked.pdf_file1_name,
            brand_ranked.youtube_url,
            brand_ranked."order",
            brand_ranked.country,
            brand_ranked.video_yn,
            brand_ranked.catalog_yn,
            brand_ranked.news_yn,
            brand_ranked.related_brand_yn,
            brand_ranked.video_idx,
            brand_ranked.catalog_idx,
            brand_ranked.news_idx1,
            brand_ranked.news_idx2,
            brand_ranked.news_idx3,
            brand_ranked.related_brand_idx1,
            brand_ranked.related_brand_idx2,
            brand_ranked.related_brand_idx3,
            brand_ranked.related_brand_idx4,
            brand_ranked.flag_del,
            brand_ranked.flag_save,
            brand_ranked.flag_show,
            brand_ranked.reg_id,
            brand_ranked.reg_dtm,
            brand_ranked.modi_id,
            brand_ranked.modi_dtm,
            brand_ranked.flag_ecatalog_show,
            brand_ranked.normalized_brand_name,
            brand_ranked.brand_family_key,
            brand_ranked.brand_rank
           FROM brand_ranked
          WHERE brand_ranked.brand_rank = 1
        ), brand_variants AS (
         SELECT active_brands.brand_family_key,
            array_agg(DISTINCT active_brands.brand_name ORDER BY active_brands.brand_name) AS brand_name_variants,
            array_agg(DISTINCT active_brands.description ORDER BY active_brands.description) FILTER (WHERE NULLIF(btrim(active_brands.description), ''::text) IS NOT NULL) AS description_variants,
            array_agg(DISTINCT active_brands.description_work_piece ORDER BY active_brands.description_work_piece) FILTER (WHERE NULLIF(btrim(active_brands.description_work_piece), ''::text) IS NOT NULL) AS description_work_piece_variants,
            array_agg(DISTINCT active_brands.category_idx ORDER BY active_brands.category_idx) FILTER (WHERE NULLIF(btrim(active_brands.category_idx), ''::text) IS NOT NULL) AS category_idx_values,
            array_agg(DISTINCT active_brands.sub_category_idx ORDER BY active_brands.sub_category_idx) FILTER (WHERE NULLIF(btrim(active_brands.sub_category_idx), ''::text) IS NOT NULL) AS sub_category_idx_values,
            array_agg(DISTINCT active_brands.country ORDER BY active_brands.country) FILTER (WHERE NULLIF(btrim(active_brands.country), ''::text) IS NOT NULL) AS raw_country_values,
            array_agg(DISTINCT active_brands.file1 ORDER BY active_brands.file1) FILTER (WHERE NULLIF(btrim(active_brands.file1), ''::text) IS NOT NULL) AS file1_values,
            array_agg(DISTINCT active_brands.file2 ORDER BY active_brands.file2) FILTER (WHERE NULLIF(btrim(active_brands.file2), ''::text) IS NOT NULL) AS file2_values,
            array_agg(DISTINCT active_brands.pdf_file1 ORDER BY active_brands.pdf_file1) FILTER (WHERE NULLIF(btrim(active_brands.pdf_file1), ''::text) IS NOT NULL) AS pdf_file_values,
            array_agg(DISTINCT active_brands.youtube_url ORDER BY active_brands.youtube_url) FILTER (WHERE NULLIF(btrim(active_brands.youtube_url), ''::text) IS NOT NULL) AS youtube_urls
           FROM active_brands
          WHERE active_brands.brand_family_key IS NOT NULL
          GROUP BY active_brands.brand_family_key
        ), brand_sub_ranked AS (
         SELECT ab.brand_family_key,
            upper(btrim(COALESCE(pbs.lang, ''::text))) AS lang,
            NULLIF(btrim(pbs.brand_name), ''::text) AS localized_brand_name,
            NULLIF(btrim(pbs.description), ''::text) AS localized_description,
            NULLIF(btrim(pbs.description_work_piece), ''::text) AS localized_description_work_piece,
            row_number() OVER (PARTITION BY ab.brand_family_key, (upper(btrim(COALESCE(pbs.lang, ''::text)))) ORDER BY pbs.prod_brand_idx DESC, pbs.reg_dtm DESC) AS lang_rank
           FROM raw_catalog.prod_brand_sub pbs
             JOIN active_brands ab ON ab.idx = pbs.prod_brand_idx
          WHERE COALESCE(pbs.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(pbs.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(btrim(COALESCE(pbs.lang, ''::text)), ''::text) IS NOT NULL
        ), brand_translations AS (
         SELECT brand_sub_ranked.brand_family_key,
            jsonb_object_agg(brand_sub_ranked.lang, jsonb_strip_nulls(jsonb_build_object('brand_name', brand_sub_ranked.localized_brand_name, 'description', brand_sub_ranked.localized_description, 'description_work_piece', brand_sub_ranked.localized_description_work_piece))) AS translations_by_lang
           FROM brand_sub_ranked
          WHERE brand_sub_ranked.lang_rank = 1
          GROUP BY brand_sub_ranked.brand_family_key
        ), iso_detail_reference AS (
         SELECT DISTINCT NULLIF(upper(btrim(COALESCE(iso_detail_reference.tag_name, ''::text))), ''::text) AS tag_name,
            NULLIF(btrim(iso_detail_reference.work_piece_name), ''::text) AS work_piece_name,
            NULLIF(regexp_replace(upper(btrim(COALESCE(iso_detail_reference.work_piece_name, ''::text))), '\s+'::text, ''::text, 'g'::text), ''::text) AS normalized_work_piece_name
           FROM catalog_app.iso_detail_reference
          WHERE NULLIF(btrim(COALESCE(iso_detail_reference.tag_name, ''::text)), ''::text) IS NOT NULL AND NULLIF(btrim(COALESCE(iso_detail_reference.work_piece_name, ''::text)), ''::text) IS NOT NULL
        ), series_rows AS (
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
                CASE
                    WHEN regexp_replace(upper(btrim(COALESCE(ps.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN regexp_replace(upper(btrim(COALESCE(ps.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE NULLIF(regexp_replace(upper(btrim(COALESCE(ps.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text)
                END AS brand_family_key
           FROM raw_catalog.prod_series ps
          WHERE COALESCE(ps.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(ps.flag_show, 'Y'::text) = 'Y'::text AND NULLIF(btrim(ps.brand_name), ''::text) IS NOT NULL
        ), brand_series AS (
         SELECT series_rows.brand_family_key,
            array_agg(DISTINCT series_rows.brand_name ORDER BY series_rows.brand_name) FILTER (WHERE NULLIF(btrim(series_rows.brand_name), ''::text) IS NOT NULL) AS series_brand_name_variants,
            array_agg(DISTINCT series_rows.series_name ORDER BY series_rows.series_name) FILTER (WHERE NULLIF(btrim(series_rows.series_name), ''::text) IS NOT NULL) AS series_names,
            count(DISTINCT series_rows.normalized_series_name) FILTER (WHERE series_rows.normalized_series_name IS NOT NULL)::integer AS series_count,
            array_agg(DISTINCT series_rows.root_category ORDER BY series_rows.root_category) FILTER (WHERE NULLIF(btrim(series_rows.root_category), ''::text) IS NOT NULL) AS root_categories,
            array_agg(DISTINCT series_rows.tool_type ORDER BY series_rows.tool_type) FILTER (WHERE NULLIF(btrim(series_rows.tool_type), ''::text) IS NOT NULL) AS tool_types,
            array_agg(DISTINCT series_rows.product_type ORDER BY series_rows.product_type) FILTER (WHERE NULLIF(btrim(series_rows.product_type), ''::text) IS NOT NULL) AS product_types,
            array_agg(DISTINCT series_rows.application_shape ORDER BY series_rows.application_shape) FILTER (WHERE NULLIF(btrim(series_rows.application_shape), ''::text) IS NOT NULL) AS application_shape_values,
            array_agg(DISTINCT series_rows.cutting_edge_shape ORDER BY series_rows.cutting_edge_shape) FILTER (WHERE NULLIF(btrim(series_rows.cutting_edge_shape), ''::text) IS NOT NULL) AS cutting_edge_shape_values,
            array_agg(DISTINCT series_rows.unit ORDER BY series_rows.unit) FILTER (WHERE NULLIF(btrim(series_rows.unit), ''::text) IS NOT NULL) AS unit_values,
            array_agg(DISTINCT series_rows.country ORDER BY series_rows.country) FILTER (WHERE NULLIF(btrim(series_rows.country), ''::text) IS NOT NULL) AS raw_series_country_values,
            array_agg(DISTINCT series_rows.description ORDER BY series_rows.description) FILTER (WHERE NULLIF(btrim(series_rows.description), ''::text) IS NOT NULL) AS series_description_variants,
            array_agg(DISTINCT series_rows.feature ORDER BY series_rows.feature) FILTER (WHERE NULLIF(btrim(series_rows.feature), ''::text) IS NOT NULL) AS series_feature_variants
           FROM series_rows
          WHERE series_rows.brand_family_key IS NOT NULL
          GROUP BY series_rows.brand_family_key
        ), brand_material_tag_rows AS (
         SELECT DISTINCT sr.brand_family_key,
            NULLIF(upper(btrim(COALESCE(sm.tag_name, ''::text))), ''::text) AS tag_name
           FROM raw_catalog.prod_series_work_material_status sm
             JOIN series_rows sr ON sr.idx = sm.prod_series_idx
          WHERE COALESCE(sm.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(sm.flag_show, 'Y'::text) = 'Y'::text AND sr.brand_family_key IS NOT NULL
        ), brand_material_rows AS (
         SELECT DISTINCT sr.brand_family_key,
            NULLIF(upper(btrim(COALESCE(sm.tag_name, ''::text))), ''::text) AS tag_name,
            ref.work_piece_name,
            NULLIF(upper(btrim(COALESCE(sm.status, ''::text))), ''::text) AS status
           FROM raw_catalog.prod_series_work_material_status sm
             JOIN series_rows sr ON sr.idx = sm.prod_series_idx
             JOIN iso_detail_reference ref ON ref.tag_name = NULLIF(upper(btrim(COALESCE(sm.tag_name, ''::text))), ''::text) AND ref.normalized_work_piece_name = NULLIF(regexp_replace(upper(btrim(COALESCE(sm.work_piece_name, ''::text))), '\s+'::text, ''::text, 'g'::text), ''::text)
          WHERE COALESCE(sm.flag_del, 'N'::text) <> 'Y'::text AND COALESCE(sm.flag_show, 'Y'::text) = 'Y'::text AND sr.brand_family_key IS NOT NULL
        ), brand_material_tags AS (
         SELECT brand_material_tag_rows.brand_family_key,
            array_agg(DISTINCT brand_material_tag_rows.tag_name ORDER BY brand_material_tag_rows.tag_name) FILTER (WHERE brand_material_tag_rows.tag_name IS NOT NULL) AS material_tags
           FROM brand_material_tag_rows
          GROUP BY brand_material_tag_rows.brand_family_key
        ), brand_material_details AS (
         SELECT brand_material_rows.brand_family_key,
            array_agg(DISTINCT brand_material_rows.work_piece_name ORDER BY brand_material_rows.work_piece_name) FILTER (WHERE brand_material_rows.work_piece_name IS NOT NULL) AS material_work_piece_names,
            jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tag_name', brand_material_rows.tag_name, 'work_piece_name', brand_material_rows.work_piece_name, 'status', brand_material_rows.status)) ORDER BY brand_material_rows.tag_name, brand_material_rows.work_piece_name, brand_material_rows.status) FILTER (WHERE brand_material_rows.tag_name IS NOT NULL OR brand_material_rows.work_piece_name IS NOT NULL OR brand_material_rows.status IS NOT NULL) AS work_piece_statuses
           FROM brand_material_rows
          GROUP BY brand_material_rows.brand_family_key
        ), brand_materials AS (
         SELECT tags.brand_family_key,
            tags.material_tags,
            details.material_work_piece_names,
            details.work_piece_statuses
           FROM brand_material_tags tags
             LEFT JOIN brand_material_details details ON details.brand_family_key = tags.brand_family_key
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
         SELECT
                CASE
                    WHEN regexp_replace(upper(btrim(COALESCE(pe.brand_name, sr.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN regexp_replace(upper(btrim(COALESCE(pe.brand_name, sr.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text) ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE NULLIF(regexp_replace(upper(btrim(COALESCE(pe.brand_name, sr.brand_name, ''::text))), '[\s\-·ㆍ\./(),]+'::text, ''::text, 'g'::text), ''::text)
                END AS brand_family_key,
            COALESCE(NULLIF(btrim(pe.brand_name), ''::text), sr.brand_name) AS brand_name,
            pe.edp_no,
            COALESCE(NULLIF(btrim(pe.series_name), ''::text), sr.series_name) AS series_name,
            pe.unit AS edp_unit,
            COALESCE(NULLIF(pm.option_milling_numberofflute, ''::text), NULLIF(ph.option_holemaking_numberofflute, ''::text), NULLIF(pt.option_threading_numberofflute, ''::text), NULLIF(pe.option_numberofflute, ''::text), NULLIF(pe.option_z, ''::text)) AS flute_raw,
            COALESCE(NULLIF(pm.option_milling_coating, ''::text), NULLIF(ph.option_holemaking_coating, ''::text), NULLIF(pt.option_threading_coating, ''::text)) AS coating,
            COALESCE(NULLIF(pm.option_milling_toolmaterial, ''::text), NULLIF(ph.option_holemaking_toolmaterial, ''::text), NULLIF(pt.option_threading_toolmaterial, ''::text)) AS tool_material,
                CASE
                    WHEN upper(COALESCE(pe.unit, ''::text)) ~~ '%INCH%'::text THEN NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_outsidedia, ''::text), NULLIF(ph.option_holemaking_outsidedia, ''::text), NULLIF(pt.option_threading_outsidedia, ''::text), NULLIF(pe.option_drill_diameter, ''::text), NULLIF(pe.option_d1, ''::text), NULLIF(pe.option_dc, ''::text), NULLIF(pe.option_d, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric * 25.4
                    ELSE NULLIF("substring"(COALESCE(NULLIF(pm.option_milling_outsidedia, ''::text), NULLIF(ph.option_holemaking_outsidedia, ''::text), NULLIF(pt.option_threading_outsidedia, ''::text), NULLIF(pe.option_drill_diameter, ''::text), NULLIF(pe.option_d1, ''::text), NULLIF(pe.option_dc, ''::text), NULLIF(pe.option_d, ''::text)), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric
                END AS diameter_mm,
            COALESCE(country_source.country_codes, ARRAY[]::text[]) AS country_codes
           FROM dedup_edp pe
             LEFT JOIN series_rows sr ON sr.idx = pe.series_idx
             LEFT JOIN edp_countries country_source ON country_source.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_milling pm ON pm.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_holemaking ph ON ph.edp_no = pe.edp_no
             LEFT JOIN raw_catalog.prod_edp_option_threading pt ON pt.edp_no = pe.edp_no
        ), brand_edp_agg AS (
         SELECT edp_enriched.brand_family_key,
            count(*)::integer AS edp_count,
            array_agg(DISTINCT edp_enriched.edp_no ORDER BY edp_enriched.edp_no) AS edp_codes,
            array_agg(DISTINCT edp_enriched.series_name ORDER BY edp_enriched.series_name) FILTER (WHERE NULLIF(btrim(edp_enriched.series_name), ''::text) IS NOT NULL) AS edp_series_names,
            array_agg(DISTINCT edp_enriched.edp_unit ORDER BY edp_enriched.edp_unit) FILTER (WHERE NULLIF(btrim(edp_enriched.edp_unit), ''::text) IS NOT NULL) AS edp_units,
            array_agg(DISTINCT NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric ORDER BY (NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric)) FILTER (WHERE NULLIF("substring"(COALESCE(edp_enriched.flute_raw, ''::text), '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text) IS NOT NULL) AS flute_counts,
            array_agg(DISTINCT edp_enriched.coating ORDER BY edp_enriched.coating) FILTER (WHERE NULLIF(btrim(edp_enriched.coating), ''::text) IS NOT NULL) AS coating_values,
            array_agg(DISTINCT edp_enriched.tool_material ORDER BY edp_enriched.tool_material) FILTER (WHERE NULLIF(btrim(edp_enriched.tool_material), ''::text) IS NOT NULL) AS tool_material_values,
            min(edp_enriched.diameter_mm) AS diameter_min_mm,
            max(edp_enriched.diameter_mm) AS diameter_max_mm
           FROM edp_enriched
          WHERE edp_enriched.brand_family_key IS NOT NULL
          GROUP BY edp_enriched.brand_family_key
        ), brand_country_rows AS (
         SELECT DISTINCT ee.brand_family_key,
            country_row.country_code
           FROM edp_enriched ee
             CROSS JOIN LATERAL unnest(ee.country_codes) country_row(country_code)
          WHERE ee.brand_family_key IS NOT NULL AND NULLIF(btrim(country_row.country_code), ''::text) IS NOT NULL
        ), brand_countries AS (
         SELECT brand_country_rows.brand_family_key,
            array_agg(DISTINCT brand_country_rows.country_code ORDER BY brand_country_rows.country_code) AS country_codes
           FROM brand_country_rows
          GROUP BY brand_country_rows.brand_family_key
        ), new_brand_rows AS (
         SELECT DISTINCT
                CASE
                    WHEN new_brand_reference.normalized_brand_name ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN new_brand_reference.normalized_brand_name ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE new_brand_reference.normalized_brand_name
                END AS brand_family_key,
            new_brand_reference.brand_name,
            new_brand_reference.is_new
           FROM catalog_app.new_brand_reference
          WHERE new_brand_reference.normalized_brand_name IS NOT NULL
        ), new_brands AS (
         SELECT new_brand_rows.brand_family_key,
            bool_or(COALESCE(new_brand_rows.is_new, false)) AS reference_is_new
           FROM new_brand_rows
          WHERE new_brand_rows.brand_family_key IS NOT NULL
          GROUP BY new_brand_rows.brand_family_key
        ), reference_brand_rows AS (
         SELECT DISTINCT
                CASE
                    WHEN br.normalized_brand_name ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN br.normalized_brand_name ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE br.normalized_brand_name
                END AS brand_family_key,
            br.brand_name,
            br.series_name,
            nb_1.reference_is_new AS is_new,
            br.tag_name,
            br.work_piece_name,
            br.hardness_min_hrc,
            br.hardness_max_hrc
           FROM catalog_app.brand_reference br
             LEFT JOIN new_brands nb_1 ON nb_1.brand_family_key =
                CASE
                    WHEN br.normalized_brand_name ~~ 'EFORCE%'::text THEN 'EFORCE'::text
                    WHEN br.normalized_brand_name ~~ '4GMILLS%'::text THEN '4GMILLS'::text
                    ELSE br.normalized_brand_name
                END
          WHERE br.normalized_brand_name IS NOT NULL
        ), reference_brands AS (
         SELECT reference_brand_rows.brand_family_key,
            array_agg(DISTINCT reference_brand_rows.brand_name ORDER BY reference_brand_rows.brand_name) FILTER (WHERE NULLIF(btrim(reference_brand_rows.brand_name), ''::text) IS NOT NULL) AS reference_brand_names,
            array_agg(DISTINCT reference_brand_rows.series_name ORDER BY reference_brand_rows.series_name) FILTER (WHERE NULLIF(btrim(reference_brand_rows.series_name), ''::text) IS NOT NULL) AS reference_series_names,
            array_agg(DISTINCT reference_brand_rows.tag_name ORDER BY reference_brand_rows.tag_name) FILTER (WHERE NULLIF(btrim(reference_brand_rows.tag_name), ''::text) IS NOT NULL) AS reference_iso_groups,
            array_agg(DISTINCT reference_brand_rows.work_piece_name ORDER BY reference_brand_rows.work_piece_name) FILTER (WHERE NULLIF(btrim(reference_brand_rows.work_piece_name), ''::text) IS NOT NULL) AS reference_work_piece_names,
            min(reference_brand_rows.hardness_min_hrc) AS reference_hrc_min,
            max(reference_brand_rows.hardness_max_hrc) AS reference_hrc_max,
            jsonb_agg(jsonb_strip_nulls(jsonb_build_object('series_name', reference_brand_rows.series_name, 'is_new', reference_brand_rows.is_new, 'tag_name', reference_brand_rows.tag_name, 'work_piece_name', reference_brand_rows.work_piece_name, 'hardness_min_hrc', reference_brand_rows.hardness_min_hrc, 'hardness_max_hrc', reference_brand_rows.hardness_max_hrc)) ORDER BY reference_brand_rows.series_name, reference_brand_rows.tag_name, reference_brand_rows.work_piece_name, reference_brand_rows.hardness_min_hrc, reference_brand_rows.hardness_max_hrc) AS reference_profiles
           FROM reference_brand_rows
          WHERE reference_brand_rows.brand_family_key IS NOT NULL
          GROUP BY reference_brand_rows.brand_family_key
        )
 SELECT bb.brand_family_key AS normalized_brand_name,
    bb.brand_name,
    bb.description AS primary_description,
    bb.description_work_piece AS primary_description_work_piece,
    bb.category_idx AS primary_category_idx,
    bb.sub_category_idx AS primary_sub_category_idx,
    bb.country AS primary_country,
    bv.brand_name_variants,
    bv.description_variants,
    bv.description_work_piece_variants,
    bv.category_idx_values,
    bv.sub_category_idx_values,
    bv.raw_country_values,
    bv.file1_values,
    bv.file2_values,
    bv.pdf_file_values,
    bv.youtube_urls,
    bt.translations_by_lang,
    bs.series_brand_name_variants,
    bs.series_names,
    bs.series_count,
    bs.root_categories,
    bs.tool_types,
    bs.product_types,
    bs.application_shape_values,
    bs.cutting_edge_shape_values,
    bs.unit_values,
    bs.raw_series_country_values,
    bs.series_description_variants,
    bs.series_feature_variants,
    bm.material_tags,
    bm.material_work_piece_names,
    bm.work_piece_statuses,
    bc.country_codes,
    bea.edp_count,
    bea.edp_codes,
    bea.edp_series_names,
    bea.edp_units,
    bea.flute_counts,
    bea.coating_values,
    bea.tool_material_values,
    bea.diameter_min_mm,
    bea.diameter_max_mm,
    rb.reference_brand_names,
    rb.reference_series_names,
    nb.reference_is_new,
    rb.reference_iso_groups,
    rb.reference_work_piece_names,
    rb.reference_hrc_min,
    rb.reference_hrc_max,
    rb.reference_profiles
   FROM brand_base bb
     LEFT JOIN brand_variants bv ON bv.brand_family_key = bb.brand_family_key
     LEFT JOIN brand_translations bt ON bt.brand_family_key = bb.brand_family_key
     LEFT JOIN brand_series bs ON bs.brand_family_key = bb.brand_family_key
     LEFT JOIN brand_materials bm ON bm.brand_family_key = bb.brand_family_key
     LEFT JOIN brand_countries bc ON bc.brand_family_key = bb.brand_family_key
     LEFT JOIN brand_edp_agg bea ON bea.brand_family_key = bb.brand_family_key
     LEFT JOIN reference_brands rb ON rb.brand_family_key = bb.brand_family_key
     LEFT JOIN new_brands nb ON nb.brand_family_key = bb.brand_family_key;