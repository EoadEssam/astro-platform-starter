# مقترح هجرة `expense_payments` (للمراجعة، لم يُنفَّذ)

**الحالة:** **مقترح.** التصميم معتمد من المالك في 2026-11-26 (O-6، مراجعة الجولة 10). التنفيذ ينتظر مراجعة هذا المقترح وموافقة
مستقلة. لا SQL شُغّل، ولا تعديل على مستودع الخلفية. النص أدناه مسودة يكتب فريق الخلفية هجرته منها، برقم هجرة جديد، ولا تُعدَّل
أي هجرة قائمة.

## ما في الخلفية اليوم (قراءة فقط)

المرجع: فرع `feature/commercial-phase1-subscriptions` في `EoadEssam/ambs-platform`.

| المصدر                                                                      | ما فيه                                                                                                                                                                                                       |
| :-------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poc-lab/db/03_schema_fin.sql` (SHA-256 `e037dee3…77b8`، مطابق على `main`)  | جدول PoC `ambs_txn.expenses` بخمسة أعمدة: `tenant_id`، `id`، `project_id`، `amount`، `cost_date`. الملف نفسه يصف نفسه «ملف اختبار، لم يُنفَّذ». **لا `paid_amount` ولا `paid_on` ولا `settlement_status` فيه.** |
| `docs/architecture/AMBS_v2_1_MVP_ERD.mmd` (EXPENSES)                        | التصميم الكامل: `paid_amount` و`paid_on` و`settlement_status` حقول على صف المصروف، بلا جدول دفعات                                                                                                            |
| `poc-lab/db/08_seed_synthetic.sql` السطر 120                                | 60 مصروفًا اصطناعيًا للشركة TA، بلا أي دفع                                                                                                                                                                     |
| `commercial-phase1/sql/004_financial_subscription_gate_candidate.sql` (C15) | سياسات `RESTRICTIVE` على `ambs_txn.expenses` و`ambs_txn.contracts` فقط. فحصه المسبق يشترط هذين الجدولين بالعدد (`<>2`)                                                                                       |
| `docs/notion-migration/migration-plan-v2_1.md` السطر 98                     | عند الترحيل: «`settlement_status` لا يُفترض `paid`»                                                                                                                                                           |

**النتيجة:** لا توجد قاعدة بيانات إنتاج، ولا هجرة حقيقية لجدول المصروفات بعد. البيانات القائمة اصطناعية في مختبر PoC وحده، ولا دفعات
فيها.

## التصميم المقترح

```sql
-- مسودة للمراجعة، لا تُشغَّل كما هي. رقم الهجرة يحدده فريق الخلفية.
CREATE TABLE ambs_txn.expense_payments (
  tenant_id                 uuid          NOT NULL,
  id                        uuid          NOT NULL DEFAULT gen_random_uuid(),
  expense_id                uuid          NOT NULL,
  amount                    numeric(18,4) NOT NULL CHECK (amount > 0),
  currency_code             char(3)       NOT NULL REFERENCES currencies(currency_code),
  paid_on                   date          NOT NULL,
  recorded_by_membership_id uuid          NOT NULL,
  idempotency_key           text          NOT NULL,
  created_at                timestamptz   NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, expense_id) REFERENCES ambs_txn.expenses(tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by_membership_id) REFERENCES tenant_memberships(tenant_id, id),
  UNIQUE (tenant_id, recorded_by_membership_id, idempotency_key)
);
ALTER TABLE ambs_txn.expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ambs_txn.expense_payments FORCE ROW LEVEL SECURITY;
-- لا UPDATE ولا DELETE لأي دور تشغيلي: الدفعة لا تُعدَّل ولا تُحذف؛ عكسها إجراء لاحق مستقل
```

**قواعد تُفرض في دالة الكتابة الواحدة (لا في الواجهة):**

1. `SELECT … FROM ambs_txn.expenses WHERE … FOR UPDATE` على صف المصروف أولًا، فلا تتسابق دفعتان على المتبقي نفسه.
2. المصروف `approved`، وإلا `invalid_transition`.
3. عملة الدفعة = عملة المصروف، وإلا `currency_mismatch`. وعدد منازل المبلغ لا يتجاوز `currencies.decimals`، ولا تقريب.
4. مجموع الدفعات بعد الإضافة ≤ `amount + coalesce(tax_amount, 0)`، وإلا `overpayment`. كل ذلك داخل المعاملة نفسها.
5. تحديث `paid_amount` و`paid_on` و`settlement_status` على صف المصروف في المعاملة نفسها (انظر الخيار أ أدناه).
6. سطر تدقيق لكل دفعة.

**الإجمالي والمتبقي (O-15):** يُحسبان في الخادم من الصف والدفعات، ولا يُخزَّنان عمودين مستقلين. بذلك لا يوجد رقمان قد يختلفان.

## أين تبقى `paid_amount` و`paid_on` و`settlement_status`

| الخيار          | الوصف                                                                                                                                            | الخطر                                                                                                                                  |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **أ (أوصي به)** | تبقى أعمدة على `expenses` كما في الـERD، وتحدّثها دالة الدفع وحدها في المعاملة نفسها، مع `CHECK (paid_amount <= amount + coalesce(tax_amount,0))` | اختلاف بين العمود ومجموع الدفعات إن كتب أحد خارج الدالة. يُمنع بالصلاحيات (لا `UPDATE` مباشر على هذه الأعمدة)، ويُكشف باستعلام تحقق دوري |
| ب               | تُحذف من `expenses` وتُحسب في عرض (view) من الدفعات                                                                                                | أنظف، لكنه يغيّر الـERD ويؤثر في استعلامات التقارير القائمة في التصميم (`R4` في خطة الترحيل)                                            |

## الأثر على البيانات القائمة

- **الإنتاج:** لا بيانات، فلا أثر.
- **مختبر PoC:** جدول `expenses` فيه لا يحمل حقول الدفع أصلًا، والصفوف الستون الاصطناعية بلا دفع. الهجرة تضيف جدولًا فارغًا ولا تغيّر أي صف.
- **إن وُجدت صفوف فيها `paid_amount > 0` قبل الهجرة** (مثلًا من ترحيل Notion): تُنشأ لكل صف دفعة واحدة بمبلغ `paid_amount`
  وتاريخ `paid_on`، و`recorded_by_membership_id` = عضوية الترحيل، و`idempotency_key` = `migration:<expense id>`. ويُعلَّم أن تفاصيل
  الدفعات الجزئية السابقة غير معروفة. ولا يُفترض `paid` لما لم يُسجَّل دفعه (خطة الترحيل، السطر 98).
- **استعلام التحقق بعد الهجرة:** لكل مصروف، `paid_amount` = مجموع دفعاته، ولا مصروف مجموع دفعاته أكبر من إجماليه. أي صف يخالف
  يوقف الإطلاق.

## ما لا يقرره هذا المقترح (يحتاج قرارًا مستقلًا)

1. **بوابة الاشتراك على الجدول الجديد.** C15 (`004`) يغطي `expenses` و`contracts` فقط، وفحصه المسبق يعدّ الجدولين. الجدول الجديد لا تشمله
   تلقائيًا. إضافة سياسات له مثل C16 قرار لفريق الخلفية وللمالك. **هذا المقترح لا يمس C15 ولا C16.**
2. **سياسات النطاق (RLS)** للجدول الجديد على غرار `15_finance_child_scope.sql`: القراءة والكتابة عبر صلاحية المصروف الأب ونطاق مشروعه.
3. **الأدوار والصلاحيات:** من يُدرج في الجدول (دالة الدفع وحدها بصلاحية `expense.pay`)، ولا `UPDATE` أو `DELETE` لأحد.
4. **رقم الهجرة وتحديث أساس الفحص (baseline)** يُعرضان على المالك قبل التشغيل، كما تقضي قواعد المشروع.
