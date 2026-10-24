# 人工评估材料

本目录只有设计用例和空白结果模板，没有任何虚构实测数据，也没有已上传的外部评估数据集。12 条用例均待团队人工审核；其中的预期行为是设计标准草案，不能直接视为经用户验证的真值。

## 文件

- `cases.csv`：12 条待审核设计用例。输入描述、预期行为和元数据分列；真实素材引用与最终审核标准留待人工填写。
- `results-template.csv`：只有表头。复制后记录一次运行一行，保留原模板为空。
- `report-template.md`：简短报告模板，未测项和样本数均留待填写。
- 完整执行方法见 `../docs/testing.md`。

## 用例审核

1. 检查测试布置能否复现，并为需要画面的案例补充真实桌面素材或现场说明。
2. 人工核实物品身份、移动方向和抓取状态，填写 `approved_expected_behavior`、`reviewer`、`reviewed_at`。
3. 只有审核完成才将 `review_status` 改为 `approved`。不通过的设计保留并写明原因，不伪装成已执行。
4. 用例中的 `input_asset_id` 只是经同意采集素材的内部编号；不放密钥、音频、截图 data URL 或个人信息。

## 结果字段

| 字段组 | 填写说明 |
| --- | --- |
| `run_id`、`case_id`、`executed_at`、`reviewer` | 唯一运行号、用例号、实际执行时间与观察员 |
| `mode`、`prompt_style`、`prompt_version`、`model_name` | `mock`/`live` 和 `baseline`/`accessible` 必须分开；记录实际配置 |
| `app_version`、`device_browser`、`input_asset_id` | 版本、真实设备和经审核素材编号；现场无保存素材可记录场景编号 |
| `human_truth`、`model_action`、`model_grasp_state` | 人工真值与模型原始结构化判断分别填写 |
| `test_verdict` | `pass` / `fail` / `not_run` / `not_applicable`；是测试判定，不是抓取真值 |
| `actual_task_outcome` | `correct` / `wrong` / `unknown` / `not_performed`；mock 一律为 `not_performed` |
| `actionable_score` | 表达评分 0、1、2；未评留空，不能猜测 |
| `backend_latency_ms`、`capture_to_speech_ms` | 两种计时分别填；没有测得就留空 |
| `human_help_count`、`http_status`、`error_type` | 人工帮助数、真实响应码与错误类别；未测留空 |
| `observation`、`follow_up` | 具体观察和下一步修复；不要记录秘密或个人信息 |

密钥无效用例中，明确报错可以使“错误处理”用例通过，但 `actual_task_outcome` 仍是 `not_performed`，不能算识别成功。`model_grasp_state=confirmed` 而人工观察拿错，应记录误确认和失败。网络失败时不能补填预计时延。

## 提示词对照

从审核通过、适用于提示词比较的用例中选相同输入，分别运行 baseline 与 accessible，给两次结果相同的 `input_asset_id`。不要把无效密钥、相机权限或 mock 固定输出作为提示词能力优劣的证据。baseline 只供回放和观察，不用于真实手部指挥。

人工先检查事实判断，再检查面向本人方向、一个动作、可理解的不确定表达。未通过项必须保留；没有真实数据前不计算“提升百分比”。最终报告同时说明样本量、失败项和仍未验证的设备或人群。

材料设计参考 [Langfuse 数据集指南](https://langfuse.com/academy/datasets) 对输入、预期与元数据的区分，以及[指标选择指南](https://langfuse.com/academy/evaluate/choosing-what-to-evaluate) 对可观察、能支持决策的指标的建议。当前交付不依赖 Langfuse 账号或 SDK，也未配置在线评测。
