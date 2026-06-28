-- =============================================================
-- Havier Pest Control — User Role Setup
-- Run this AFTER all three people have accepted their invite
-- and logged in at least once.
-- =============================================================

-- ADMIN: Ethan
update profiles
set full_name = 'Ethan',
    role      = 'admin'
where id = (select id from auth.users where email = 'ethangamez292@gmail.com');

-- TECHNICIAN: Nirvan
update profiles
set full_name = 'Nirvan',
    phone     = '917738287831',
    role      = 'technician'
where id = (select id from auth.users where email = 'nirvanfernandes17@gmail.com');

-- TECHNICIAN: Sourav  (replace with his actual email before running)
update profiles
set full_name = 'Sourav',
    phone     = '919136274331',
    role      = 'technician'
where id = (select id from auth.users where email = 'souravecom14@gmail.com');

-- Verify all three rows
select p.full_name, p.role, u.email
from profiles p
join auth.users u on u.id = p.id
where u.email in (
  'ethangamez292@gmail.com',
  'nirvanfernandes17@gmail.com',
  'souravecom14@gmail.com'
)
order by p.role, p.full_name;
