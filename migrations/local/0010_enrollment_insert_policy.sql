-- Allow authenticated users to enroll themselves in free courses directly.
-- Paid enrollments are still handled by the payment flow (service_role via webhooks).
create policy "users can insert own enrollments"
  on user_enrollments for insert
  with check (user_id = auth.uid() and payment_status = 'free' and price_paid = 0);
