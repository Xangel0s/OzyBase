-- Insert default security notification recipient (admin email)
INSERT INTO _v_security_notification_recipients (email, alert_types, is_active)
VALUES ('admin@ozybase.local', ARRAY['geo_breach', 'unauthorized_access', 'rate_limit_exceeded'], true)
ON CONFLICT DO NOTHING;
