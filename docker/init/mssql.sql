if db_id('dbm') is null create database dbm;
go
use dbm;
go
create schema sales;
go
create table dbo.customers (
  id         bigint identity primary key,
  email      nvarchar(255) not null unique,
  name       nvarchar(255),
  created_at datetime2 not null default sysutcdatetime()
);
create table sales.orders (
  id          bigint identity primary key,
  customer_id bigint not null foreign key references dbo.customers(id),
  total       decimal(12, 2) not null,
  payload     varbinary(16),
  placed_at   datetimeoffset not null default sysdatetimeoffset()
);
create index orders_customer_idx on sales.orders(customer_id);
go
create view sales.order_totals as
  select customer_id, sum(total) as total from sales.orders group by customer_id;
go
insert into dbo.customers (email, name)
  select concat('user', value, '@example.com'), concat('User ', value) from generate_series(1, 200);
insert into sales.orders (customer_id, total, payload)
  select 1 + (value % 200), value * 1.37, 0xDEADBEEF from generate_series(1, 50000);
go
