create table dbm.customers (
  id    UInt64,
  email String,
  name  Nullable(String)
) engine = MergeTree order by id;

create table dbm.orders (
  id          UInt64,
  customer_id UInt64,
  total       Decimal(12, 2) comment 'Order total',
  placed_at   DateTime64(6, 'UTC'),
  index orders_customer_idx customer_id type minmax granularity 1
) engine = MergeTree partition by toYYYYMM(placed_at) order by id comment 'Orders';

create view dbm.order_totals as
  select customer_id, sum(total) as total from dbm.orders group by customer_id;

insert into dbm.customers
  select number + 1, concat('user', toString(number + 1), '@example.com'), concat('User ', toString(number + 1))
  from numbers(200);
insert into dbm.orders
  select number + 1, 1 + ((number + 1) % 200), (number + 1) * 1.37, toDateTime64('2024-01-01 00:00:00', 6, 'UTC') + number
  from numbers(50000);
