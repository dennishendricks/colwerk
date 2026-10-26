create schema sales;

create table public.customers (
  id         bigserial primary key,
  email      text not null unique,
  name       text,
  created_at timestamptz not null default now()
);

create table sales.orders (
  id          bigserial primary key,
  customer_id bigint not null references public.customers(id),
  total       numeric(12, 2) not null,
  payload     bytea,
  placed_at   timestamp not null default now()
);
create index orders_customer_idx on sales.orders(customer_id);

create view sales.order_totals as
  select customer_id, sum(total) as total from sales.orders group by customer_id;

insert into public.customers (email, name)
  select 'user' || g || '@example.com', 'User ' || g from generate_series(1, 200) g;
insert into sales.orders (customer_id, total, payload)
  select 1 + (g % 200), (g * 1.37)::numeric(12, 2), decode('deadbeef', 'hex') from generate_series(1, 50000) g;
