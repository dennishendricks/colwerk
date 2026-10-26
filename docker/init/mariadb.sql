create table customers (
  id         bigint unsigned auto_increment primary key,
  email      varchar(255) not null unique,
  name       varchar(255),
  created_at timestamp not null default current_timestamp
);

create table orders (
  id          bigint unsigned auto_increment primary key,
  customer_id bigint unsigned not null,
  total       decimal(12, 2) not null,
  payload     varbinary(16),
  placed_at   datetime not null default current_timestamp,
  constraint orders_customer_fk foreign key (customer_id) references customers(id),
  index orders_customer_idx (customer_id)
);

create view order_totals as
  select customer_id, sum(total) as total from orders group by customer_id;

insert into customers (email, name)
  select concat('user', seq, '@example.com'), concat('User ', seq) from seq_1_to_200;
insert into orders (customer_id, total, payload)
  select 1 + (seq % 200), seq * 1.37, unhex('deadbeef') from seq_1_to_50000;
