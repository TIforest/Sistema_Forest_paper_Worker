ALTER TABLE user_roles ADD COLUMN access_roles TEXT NOT NULL DEFAULT '[]';

UPDATE user_roles
   SET access_roles = '["' || role || '"]'
 WHERE access_roles = '[]';
