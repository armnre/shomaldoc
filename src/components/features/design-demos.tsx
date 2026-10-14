"use client";

import { useState } from "react";
import { Button, Toast } from "@/components/ui";
import { Checkbox, Dialog, FileUpload, Input, JalaliDatePicker, Select, Switch, Tooltip } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";

export function DesignDemos() {
  const { dict } = useI18n();
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState(false);
  const [on, setOn] = useState(true);
  const [date, setDate] = useState("2026-03-21");

  return (
    <div className="grid gap-8">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <p className="text-sm font-semibold text-fg-muted">{dict.design.forms}</p>
          <Input label="نمونه ورودی" placeholder="متن نمونه" hint="راهنمای فیلد" />
          <Input label="ورودی با خطا" defaultValue="مقدار نامعتبر" error="این مقدار معتبر نیست." />
          <Select label="انتخاب نمونه" defaultValue="a">
            <option value="a">گزینه اول</option>
            <option value="b">گزینه دوم</option>
          </Select>
          <div className="flex flex-wrap items-center gap-6">
            <Checkbox label="پذیرش شرایط" defaultChecked />
            <Switch checked={on} onChange={setOn} label="فعال‌سازی نمونه" />
          </div>
          <JalaliDatePicker label={dict.design.datePicker} value={date} onChange={setDate} hint={date} />
        </div>
        <div className="grid content-start gap-4">
          <p className="text-sm font-semibold text-fg-muted">{dict.design.overlays}</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setModal(true)}>{dict.design.showModal}</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>{dict.design.showDrawer}</Button>
            <Button variant="accent" onClick={() => setToast((v) => !v)}>{dict.design.showToast}</Button>
            <Tooltip text="راهنمای ابزار">
              <Button variant="ghost">Tooltip</Button>
            </Tooltip>
          </div>
          {toast ? <Toast title="ذخیره شد" tone="success">تغییرات با موفقیت ثبت شد.</Toast> : null}
          <FileUpload label={dict.design.uploads} hint={dict.design.uploadHint} buttonLabel={dict.design.uploadButton} />
        </div>
      </div>

      <Dialog
        open={modal}
        onClose={() => setModal(false)}
        title={dict.design.showModal}
        footer={<Button onClick={() => setModal(false)}>{dict.common.close}</Button>}
      >
        <p className="text-sm text-fg-muted">{dict.design.sampleBody}</p>
      </Dialog>

      <Dialog
        open={drawer}
        onClose={() => setDrawer(false)}
        title={dict.design.showDrawer}
        footer={<Button variant="ghost" onClick={() => setDrawer(false)}>{dict.common.close}</Button>}
      >
        <div className={cn("grid gap-3 text-sm text-fg-muted")}>{dict.design.sampleBody}</div>
      </Dialog>
    </div>
  );
}
