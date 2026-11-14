# مرجع قراءة الخلفية وجدول الفروق

**الحالة: مرجع قراءة ثابت فقط. ليس النسخة التشغيلية المعتمدة، ولا يثبت جاهزية الربط.**

- المستودع: `EoadEssam/ambs-platform`
- الفرع: `review/poc-v4-lab-r3`
- الـcommit المرجعي: `c49c20b482e494387605075454a0a28a8b9bfac5` (2026-11-13)
- طريقة المراجعة: قراءة ملفات نسخة `git clone --depth 1` فقط. لم يُشغَّل SQL ولا Docker، ولم يُغيَّر المعمل، ولم يُعدَّل
  مستودع الخلفية.
- تاريخ القراءة: 2026-11-14.

غياب ملف أو مسار HTTP من هذا الـcommit يعني أنه غير محفوظ فيه، ولا يعني أنه لم يُنفَّذ أو لم يُختبر على نسخة Windows.
مطابقة هذا المرجع بنسخة Windows يستكملها المالك مع المراجع؛ هذا الملف يحدد ما يلزم مطابقته.

## 1. ما في المستودع

| الفرع                   | الـcommit | المحتوى                                                                                               |
| :---------------------- | :-------- | :---------------------------------------------------------------------------------------------------- |
| `main`                  | `5865fa9` | `README.md` فقط                                                                                       |
| `docs/ambs-v2-baseline` | `e807ecf` | 7 ملفات وثائق                                                                                         |
| `review/poc-v4-lab-r3`  | `c49c20b` | 241 ملفًا: `docs/`، `poc-lab/` (المعمل الأصلي)، `reviews/2026-11-12-source-recovery/`، `review-notes/` |

ثلاث طبقات داخل الفرع المرجعي، ولكل منها دور مختلف:

| الطبقة                          | ما هي                                                          | حالتها كما تصف نفسها                                                                                   |
| :------------------------------ | :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `poc-lab/`                      | مصادر المعمل الأصلية: SQL 00–08، خدمات ثلاث، اختبارات `t0xx`   | «هيكل اختبار لا كود منتج. لم تُشغَّل» (رؤوس ملفات الخدمات)                                                |
| `reviews/…/source-corrections/` | 36 ملفًا مصحَّحًا طُبّقت على Windows يوم 11 نوفمبر، مع بصمات قبل/بعد | «complete in the supplied local patch scope»                                                           |
| `reviews/…/fresh-build/`        | 21 ملف SQL ومشغّل بناء مرشح                                     | `OFFLINE_VALIDATED; LIVE_DATABASE_NOT_RUN; PACKAGE_ACCEPTANCE_BLOCKED` (`reviews/…/README.md` السطر 3) |

`reviews/2026-11-12-source-recovery/README.md` ينص: «The Windows snapshot supplied by the owner is newer than the review
branch. Do not overlay these files onto that branch's older working sources without baseline reconciliation.»

## 2. جدول الفروق: SQL الأصلي مقابل مرشح `fresh-build`

المقارنة بعد توحيد نهايات الأسطر (CRLF/LF).

| ملف `fresh-build/sql/`                  | المقابل في `poc-lab/`         | النتيجة                                                                                                    |
| :-------------------------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `00_extensions.sql`                     | `db/00_extensions.sql`        | مطابق                                                                                                      |
| `01_roles.sql`                          | `db/01_roles.sql`             | مطابق                                                                                                      |
| `02_schema_ops.sql`                     | `db/02_schema_ops.sql`        | مطابق                                                                                                      |
| `03_schema_fin.sql`                     | `db/03_schema_fin.sql`        | مطابق                                                                                                      |
| `04_schema_sec_candidate.sql`           | `db/04_schema_sec.sql`        | مختلف (+9/−5 أسطر): منح `ambs_sec_owner` قراءة العضويات، وتأهيل `public.digest` و`public.gen_random_bytes` |
| `05_schema_audit.sql`                   | `db/05_schema_audit.sql`      | مطابق (ومنه `log_event` موضوع خلل التدقيق)                                                                 |
| `06_rls_policies_candidate.sql`         | `db/06_rls_policies.sql`      | مختلف (+3 أسطر): منح `USAGE` على `ambs_sec` لـ`ambs_owner`                                                 |
| `07_grants.sql`                         | `db/07_grants.sql`            | مطابق                                                                                                      |
| `08_seed_candidate.sql`                 | `db/08_seed_synthetic.sql`    | مختلف (+7 أسطر)                                                                                            |
| `09_lab_settings.sql`                   | `scripts/09_lab_settings.sql` | مطابق                                                                                                      |
| `11_audit_read_isolation.sql`           | —                             | في المرشح فقط                                                                                              |
| `12_project_read_permission.sql`        | —                             | في المرشح فقط                                                                                              |
| `13_project_write_permission.sql`       | —                             | في المرشح فقط                                                                                              |
| `14_finance_project_scope.sql`          | —                             | في المرشح فقط                                                                                              |
| `15_finance_child_scope.sql`            | —                             | في المرشح فقط                                                                                              |
| `16_audit_role_scope.sql`               | —                             | في المرشح فقط                                                                                              |
| `17_attachment_zone_fail_closed.sql`    | —                             | في المرشح فقط                                                                                              |
| `18_archived_project_controls.sql`      | —                             | في المرشح فقط                                                                                              |
| `19_attachment_metadata_export.sql`     | —                             | في المرشح فقط                                                                                              |
| `20_storage_grants.sql`                 | —                             | في المرشح فقط؛ رأس الملف: `REVIEW DRAFT: not installed or approved for execution`                          |
| `21_security_owner_lookup_policies.sql` | —                             | في المرشح فقط                                                                                              |

لا يوجد ملف رقمه 10 في `fresh-build/sql/`.

في `poc-lab/` فقط، بلا مقابل في المرشح: `scripts/00_lab_admin_prepare.sql`، `scripts/10_postrevoke_assertions.sql`،
`scripts/99_test_only_now_variant.sql`، `scripts/bootstrap_least_privilege.sql`، `scripts/restore_permissions.sql`،
`scripts/revoke_bootstrap.sql`، `scripts/set_passwords.sql`.

## 3. جدول الفروق: الخدمات والاختبارات

| العنصر                                   | في `poc-lab/` بالفرع                                        | في `source-corrections/`                                                               | الملاحظة                                                                                                 |
| :--------------------------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `services/auth-service/app.py`           | موجود: `POST /issue`، `POST /revoke`                        | غير موجود                                                                              | الأصل فقط                                                                                                |
| `services/fin-service/app.py`            | موجود: يجيب أي `GET` بقراءة `project_financials`            | غير موجود                                                                              | الاختبار `25_finance_http_context.py` يطلب `GET /financials`                                             |
| `services/ops-service/app.py`            | موجود: `POST /mixed-write` وحده                             | غير موجود                                                                              | الاختبار `50_attachment_export_http.py` يطلب `POST /attachments/export`؛ **كود هذا المسار ليس في الفرع** |
| `services/ops-service/Dockerfile`        | موجود؛ بصمته تطابق `before_sha256` في `PATCH_MANIFEST.json` | نسخة مصحَّحة (`after_sha256`)                                                            | الفرع يحمل النسخة السابقة للتصحيح                                                                        |
| `poc-lab/rebuild-suite/`                 | **المجلد غير موجود**                                        | 30 ملفًا تحته (Dockerfile، وثيقتا ترحيل، 25 اختبارًا مرقّمًا، `rebuild_guard.py`، المشغّل)  | خدمات `rebuild-suite` (`app.py`) غير محفوظة في أي مكان بالفرع                                            |
| اختبارات المراجعة المرقّمة                | —                                                           | 25 من 57: `06 10 11 12 13 14 15 17 25 26 27 28 29 30 32 33 35 36 39 40 45 50 53 54 57` | الـ32 الباقية غير محفوظة في الفرع                                                                        |
| `docs/decisions/015a-…md`                | غير موجود في `docs/decisions/` بالفرع                       | موجود                                                                                  | قرار مرجعي للترحيل 21                                                                                    |
| `poc-lab/db/MIGRATION_INDEX.md` وأخواتها | غير موجودة                                                  | موجودة                                                                                 | فهرس الترحيلات ليس في شجرة العمل                                                                         |

من ملفات `source-corrections/files` الـ36: واحد فقط له مقابل في شجرة الفرع (`ops-service/Dockerfile`، وهو مختلف)، والـ35
الباقية لا مقابل لها. الحمولات الـ36 كلها تطابق `after_sha256` في `PATCH_MANIFEST.json` (تحقق محلي بالبصمات).

## 4. ما ينقص GitHub (يلزم للمطابقة مع Windows)

مذكور في وثائق الفرع وغير محفوظ فيه:

| العنصر                                                                    | أين ذُكر                                                    | لماذا يلزم                                                          |
| :------------------------------------------------------------------------ | :--------------------------------------------------------- | :------------------------------------------------------------------ |
| مصادر خدمات `rebuild-suite` (`ops`/`fin`/`auth` بمساراتها الحالية)        | اختبارات `25`، `50`، `54`                                  | هي التي تحدد عقد HTTP الفعلي؛ بدونها العقد مستنتج من الاختبارات فقط |
| الاختبارات الـ32 الباقية من حزمة الـ57 ومشغّلها الكامل                     | `VALIDATION.md` («rerun all 57 tests»)                     | إعادة التحقق بعد التصحيحات                                          |
| `AMBS_v2_1_PoC_Package_v4_LAB_r6.zip` (121 ملفًا)                          | `review-notes/POC_V4_LAB_R6_REVIEW.md`                     | النص: «not yet uploaded to this branch»                             |
| `AMBS-fresh-database-evidence-20261112-105636.zip`                        | `fresh-evidence-review/EVIDENCE_REVIEW.md`                 | مذكور ببصمته `f855c8a6…`؛ الملف نفسه غير محفوظ                      |
| `AMBS-fresh-catalog-20261112-110410.zip`                                  | `catalog-review-2026-11-13/REVIEW.md`                      | مذكور ببصمته `f12c390e…`؛ الملف نفسه غير محفوظ                      |
| سجلات SQL والجلسات الخام للتشغيل `complete-review-20261107T110953588665Z` | `VALIDATION.md` («Raw SQL/session logs were not supplied») | بدونها: اتساق أدلة لا إعادة تشغيل مستقلة                            |
| نتيجة مسبار التدقيق `audit-probe-2026-11-13/probe_audit.py`               | آخر commit في الفرع                                        | المسبار محفوظ، ونتيجته غير محفوظة                                   |
| مطابقة نسخة Windows نفسها ببصمات                                          | `reviews/…/README.md`                                      | النص يصرّح بأنها أحدث من الفرع                                       |

**تبقى محلية ولا تُرفع:** `.env`، `userlist.txt`، `credentials.json`، كلمات المرور، الملفات الخاصة، نسخ قاعدة البيانات.
أي حزمة أدلة تُفحص بحثًا عن أسرار قبل رفعها.

## 5. المطلوب لتوحيد المرجع

1. commit واحد يحتوي المصادر المقصودة (SQL، الخدمات، الاختبارات) وأدلتها، مع بصمات.
2. لكل ملف في الجدولين 2 و3: هل نسخة Windows تطابق الفرع، أم المرشح، أم تختلف عنهما.
3. إبقاء حالة القبول معلّقة إلى أن ينتهي التحقق؛ هذا الملف لا يغيّرها.

لا تُستبدل أي نسخة ولا يُعاد بناؤها ضمن هذه الخطوة.

## 6. خلل حدود التدقيق: مفتوح

المصدر: `reviews/2026-11-12-source-recovery/catalog-review-2026-11-13/REVIEW.md`، قسم «Audit boundary finding — must be
behaviorally tested» (قُرئ كاملًا)، و`fresh-evidence-review/EVIDENCE_REVIEW.md` قسم «Security follow-up».

- `ambs_audit.log_event` (`fresh-build/sql/05_schema_audit.sql` الأسطر 46–66) دالة `SECURITY DEFINER` تقبل من المستدعي
  المستأجر والحدث والمجال والنتيجة والحمولة وتُدرجها مباشرة، وتسجّل `session_user` في `actor_role`. لا تطابق المستأجر
  بسياق الطلب.
- أدوار الدخول التطبيقية الخمسة تملك `USAGE` على المخطط و`EXECUTE` صريحًا على الدالة، فضلًا عن `EXECUTE` لـ`PUBLIC`؛
  فسحب `PUBLIC` وحده لا يزيل مسار الاستدعاء المباشر.
- ما يثبته الدليل الساكن: وجود مسار الاستدعاء وغياب فحص المستأجر. ما لا يثبته: نجاح تنفيذ خبيث، أو تعرّض عبر HTTP، أو
  قراءة بيانات أعمال عابرة للمستأجرين. التقرير يصنّفه «audit-integrity validation gap, not a proved data exfiltration exploit».
- الخطوة التي يطلبها التقرير: استدعاء اصطناعي بدور تطبيقي بمستأجر غير مرتبط، وتسجيل القبول أو الرفض بدقة، والتحقق من
  التراجع من جلسة مستقلة، مع احتساب تقدّم التسلسلات. وعند تصميم الإصلاح: الحفاظ على تسجيل المحرّكات والمصادقة والتخزين
  الداخلي، وعلى دلالة فشل التدقيق الإلزامي.
- في الفرع: المسبار محفوظ (`audit-probe-2026-11-13/probe_audit.py` واختباراته غير المتصلة). **لا نتيجة تشغيل، ولا إصلاح،
  ولا اختبار إصلاح مستقل.**

**الحالة: مفتوح.** يبقى مفتوحًا إلى أن يتوفر إصلاح واختبار مستقل له. نشر الواجهة أو كتابة العقد لا يغلقه. أثره على
العقود في `http-contract-draft.md` القسم 9.
